// Consulta todas las fuentes y devuelve una foto del mercado.
// No escribe nada ni sabe dónde se va a guardar: eso lo decide quien la llame.
//
// Las fuentes están elegidas por una razón concreta: son las únicas que
// respondieron desde una IP de datacenter. Ver README y scripts/sondeo.mjs.

import { aNumero, interpretarBcu, interpretarSwissquote, interpretarDolarApi,
         interpretarBluelytics, calcularBrecha, calcularDxy } from './parseo.mjs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TIMEOUT = 12_000; // la corrida entera tiene 30 s: ningún pedido puede comerse todo

const BCU_URL = 'https://cotizaciones.bcu.gub.uy/wscotizaciones/servlet/awsbcucotizaciones';
const BCU_MONEDA = 2225; // DLS. USA BILLETE

const PARES_DXY = [
  ['EUR', 'EUR/USD', true],   // invertido: la fuente lo cotiza en dólares por euro
  ['JPY', 'USD/JPY', false],
  ['GBP', 'GBP/USD', true],
  ['CAD', 'USD/CAD', false],
  ['SEK', 'USD/SEK', false],
  ['CHF', 'USD/CHF', false],
];

export async function reunirDatos() {
  const incidencias = [];
  const anotar = (msg) => { incidencias.push(msg); console.warn('! ' + msg); };

  async function pedir(url, opciones = {}) {
    const r = await fetch(url, {
      ...opciones,
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'User-Agent': UA, ...(opciones.headers || {}) },
    });
    const texto = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status} en ${new URL(url).host} — ${texto.slice(0, 120)}`);
    return texto;
  }

  const json = (url) => pedir(url, { headers: { Accept: 'application/json' } }).then(JSON.parse);

  // --- metales ---
  async function metal(simbolo) {
    const d = await json(`https://api.gold-api.com/price/${simbolo}`);
    const precio = aNumero(d?.price);
    if (precio === null) throw new Error(`respuesta sin precio para ${simbolo}`);
    return { precio, momento: d.updatedAt ?? null, fuente: 'gold-api.com' };
  }

  // --- divisas ---
  // Swissquote publica precios vivos; el BCE queda de respaldo, con su tasa
  // diaria, que para un tablero que se mira seguido parece congelada.
  async function divisasVivas() {
    const pedidos = PARES_DXY.map(async ([moneda, par, invertido]) => {
      const medio = interpretarSwissquote(
        await json(`https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${par}`));
      if (medio === null) throw new Error(`sin precio para ${par}`);
      return [moneda, par, invertido ? 1 / medio : medio, medio];
    });
    const tasas = {}, directo = {};
    for (const [moneda, par, tasa, medio] of await Promise.all(pedidos)) {
      tasas[moneda] = tasa;
      directo[par] = medio;
    }
    return { tasas, directo, momento: new Date().toISOString(), fuente: 'Swissquote' };
  }

  async function divisasDelBce() {
    const d = await json('https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,JPY,GBP,CAD,SEK,CHF');
    if (!d?.rates) throw new Error('respuesta sin tasas');
    const eur = aNumero(d.rates.EUR);
    return {
      tasas: d.rates,
      directo: { 'EUR/USD': eur ? +(1 / eur).toFixed(6) : null, 'USD/JPY': aNumero(d.rates.JPY) },
      momento: d.date ?? null, // fecha sin hora: el BCE publica un valor por día
      fuente: 'BCE vía frankfurter.dev',
    };
  }

  // --- Brasil ---
  async function brasil() {
    const intentos = [
      { url: 'https://api.fxratesapi.com/latest?base=USD&currencies=BRL', fuente: 'fxratesapi.com', vivo: true },
      { url: 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=BRL', fuente: 'BCE vía frankfurter.dev', vivo: false },
    ];
    for (const { url, fuente, vivo } of intentos) {
      try {
        const d = await json(url);
        const valor = aNumero(d?.rates?.BRL);
        if (valor === null || valor <= 0 || valor > 100) throw new Error('sin un valor plausible para BRL');
        return { estado: 'ok', valor: +valor.toFixed(4), fuente, vivo, momento: d.date ?? null };
      } catch (e) { anotar(`Brasil (${fuente}): ${e.message}`); }
    }
    return { estado: 'error', valor: null };
  }

  // --- Argentina ---
  // El blue no tiene fuente oficial: sale de agregadores que relevan el mercado
  // informal, y el valor difiere entre uno y otro. Por eso se guarda cuál fue.
  async function argentina() {
    const intentos = [
      { url: 'https://dolarapi.com/v1/dolares', fuente: 'dolarapi.com', leer: interpretarDolarApi },
      { url: 'https://api.bluelytics.com.ar/v2/latest', fuente: 'bluelytics.com.ar', leer: interpretarBluelytics },
    ];
    for (const { url, fuente, leer } of intentos) {
      try {
        const r = leer(await json(url));
        if (!r) throw new Error('no se reconocieron el oficial ni el blue');
        return { ...r, fuente, brecha: calcularBrecha(r.oficial?.promedio, r.blue?.promedio) };
      } catch (e) { anotar(`Argentina (${fuente}): ${e.message}`); }
    }
    return { estado: 'error', oficial: null, blue: null, brecha: null };
  }

  // --- Uruguay ---
  // Se pide una ventana de días porque el BCU publica por día hábil: un feriado
  // o un fin de semana largo dejarían la consulta de un solo día sin resultado.
  async function bcu() {
    const hoy = new Date();
    const desde = new Date(hoy.getTime() - 10 * 86400_000).toISOString().slice(0, 10);
    const sobre = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cot="Cotiza">
  <soapenv:Body><cot:wsbcucotizaciones.Execute><cot:Entrada>
    <cot:Moneda><cot:item>${BCU_MONEDA}</cot:item></cot:Moneda>
    <cot:FechaDesde>${desde}</cot:FechaDesde>
    <cot:FechaHasta>${hoy.toISOString().slice(0, 10)}</cot:FechaHasta>
    <cot:Grupo>0</cot:Grupo>
  </cot:Entrada></cot:wsbcucotizaciones.Execute></soapenv:Body>
</soapenv:Envelope>`;
    try {
      const xml = await pedir(BCU_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'Cotizaaction/AWSBCUCOTIZACIONES.Execute' },
        body: sobre,
      });
      const leido = interpretarBcu(xml);
      if (leido.estado !== 'ok') anotar(`BCU: ${leido.error}`);
      return leido;
    } catch (e) {
      anotar(`BCU inalcanzable: ${e.message}`);
      return { estado: 'error', error: e.message };
    }
  }

  // Todo en paralelo: la corrida tiene 30 segundos de techo y en serie sobraban
  // motivos para no llegar.
  const [oro, plata, fx, br, ar, uy] = await Promise.all([
    metal('XAU').catch((e) => { anotar(`oro: ${e.message}`); return null; }),
    metal('XAG').catch((e) => { anotar(`plata: ${e.message}`); return null; }),
    divisasVivas().catch(async (e) => {
      anotar(`divisas (Swissquote): ${e.message}`);
      return divisasDelBce().catch((e2) => { anotar(`divisas (BCE): ${e2.message}`); return null; });
    }),
    brasil(),
    argentina(),
    bcu(),
  ]);

  const mercado = {};
  const guardar = (id, nombre, unidad, datos) => {
    mercado[id] = datos
      ? { nombre, unidad, estado: 'ok', ...datos }
      : { nombre, unidad, estado: 'error', precio: null, fuente: null, momento: null };
  };

  guardar('oro', 'Oro', 'USD / onza troy', oro);
  guardar('plata', 'Plata', 'USD / onza troy', plata);

  if (fx) {
    guardar('eurusd', 'EUR / USD', 'dólares por euro',
      fx.directo['EUR/USD'] ? { precio: +fx.directo['EUR/USD'].toFixed(4), fuente: fx.fuente, momento: fx.momento } : null);
    guardar('usdjpy', 'USD / JPY', 'yenes por dólar',
      fx.directo['USD/JPY'] ? { precio: +fx.directo['USD/JPY'].toFixed(2), fuente: fx.fuente, momento: fx.momento } : null);
    const dxy = calcularDxy(fx.tasas);
    guardar('dxy', 'Índice dólar (DXY)', 'puntos — calculado',
      dxy ? { precio: dxy, fuente: `calculado sobre ${fx.fuente}`, momento: fx.momento, calculado: true } : null);
    if (!dxy) anotar('dxy: faltó alguna moneda de la canasta, no se pudo calcular');
  } else {
    guardar('eurusd', 'EUR / USD', 'dólares por euro', null);
    guardar('usdjpy', 'USD / JPY', 'yenes por dólar', null);
    guardar('dxy', 'Índice dólar (DXY)', 'puntos — calculado', null);
  }

  const uyu = uy.promedio ?? null;
  const precioOro = mercado.oro?.precio ?? null;

  return {
    actualizado: new Date().toISOString(),
    mercado,
    bcu: {
      estado: uy.estado, nombre: uy.nombre ?? null, compra: uy.compra ?? null, venta: uy.venta ?? null,
      promedio: uy.promedio ?? null, fecha: uy.fecha ?? null, error: uy.error ?? null,
    },
    brasil: br,
    argentina: ar,
    // Calculado acá, no tomado de ninguna fuente: cruce del oro (USD/oz) con el
    // dólar uruguayo de esta misma corrida. No es una cotización de mercado.
    derivado: {
      baseDolar: uyu ? 'BCU' : null,
      oroEnPesosPorOnza: precioOro && uyu ? +(precioOro * uyu).toFixed(2) : null,
      oroEnPesosPorGramo: precioOro && uyu ? +((precioOro / 31.1035) * uyu).toFixed(2) : null,
    },
    incidencias,
  };
}

// El punto que se guarda en la serie: solo números, para que el histórico no
// crezca con texto repetido en cada medición.
export function puntoDe(foto) {
  return {
    t: foto.actualizado,
    oro: foto.mercado.oro?.precio ?? null,
    plata: foto.mercado.plata?.precio ?? null,
    dxy: foto.mercado.dxy?.precio ?? null,
    eurusd: foto.mercado.eurusd?.precio ?? null,
    usdjpy: foto.mercado.usdjpy?.precio ?? null,
    bcu: foto.bcu.promedio ?? null,
    bevsa: null,
    brl: foto.brasil?.valor ?? null,
    arsOficial: foto.argentina?.oficial?.promedio ?? null,
    arsBlue: foto.argentina?.blue?.promedio ?? null,
  };
}

export function tieneAlgo(punto) {
  return Object.keys(punto).some((k) => k !== 't' && punto[k] !== null && punto[k] !== undefined);
}
