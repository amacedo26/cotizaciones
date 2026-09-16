// Consulta todas las fuentes y devuelve una foto del mercado.
// No escribe nada ni sabe dónde se va a guardar: eso lo decide quien la llame.
//
// Las fuentes están elegidas por una razón concreta: son las únicas que
// respondieron desde una IP de datacenter. Ver README y scripts/sondeo.mjs.

import { aNumero, interpretarBcu, interpretarBrou, interpretarSwissquote, interpretarDolarApi,
         interpretarBluelytics, calcularBrecha, calcularDxy, contrastarArgentina,
         puntoDeReferencia, UYU_MIN, UYU_MAX, UI_MIN, UI_MAX, UR_MIN, UR_MAX } from './parseo.mjs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TIMEOUT = 12_000; // la corrida entera tiene 30 s: ningún pedido puede comerse todo

const BCU_URL = 'https://cotizaciones.bcu.gub.uy/wscotizaciones/servlet/awsbcucotizaciones';
// Los códigos salen del catálogo del propio BCU (servlet awsbcumonedas), no de
// memoria: 2225=DLS. USA BILLETE, 9800=UNIDAD INDEXADA, 9900=UNIDAD REAJUSTAB.
const BCU_DOLAR = 2225;
const BCU_UI = 9800;
const BCU_UR = 9900;

// El BROU no se puede leer de su propio sitio: la página de cotizaciones es un
// portal que arma la tabla en el navegador y el HTML que llega por fetch no
// tiene ni un número. dolarapi la espeja; queda anotado que es un espejo.
const BROU_URL = 'https://uy.dolarapi.com/v1/cotizaciones';

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
    // Las dos se consultan siempre, no una como respaldo de la otra: bluelytics
    // sirve de contraste. El blue no tiene fuente oficial y cada agregador
    // releva por su cuenta, así que tener una segunda lectura es la única forma
    // de notar que una se quedó vieja o se rompió.
    const leer = async (url, fuente, interpretar) => {
      try {
        const r = interpretar(await json(url));
        if (!r) throw new Error('no se reconocieron el oficial ni el blue');
        return r;
      } catch (e) {
        anotar(`Argentina (${fuente}): ${e.message}`);
        return null;
      }
    };

    const [deDolarapi, deBluelytics] = await Promise.all([
      leer('https://dolarapi.com/v1/dolares', 'dolarapi.com', interpretarDolarApi),
      leer('https://api.bluelytics.com.ar/v2/latest', 'bluelytics.com.ar', interpretarBluelytics),
    ]);

    const armar = (base, fuente, contraste) => ({
      ...base,
      fuente,
      brecha: calcularBrecha(base.oficial?.promedio, base.blue?.promedio),
      contraste,
    });

    if (deDolarapi) {
      const c = contrastarArgentina(deDolarapi, deBluelytics);
      if (c.discrepa) {
        anotar(`Argentina: las fuentes discrepan (oficial ${c.difOficial}%, blue ${c.difBlue}%)`);
      }
      return armar(deDolarapi, 'dolarapi.com', { fuente: 'bluelytics.com.ar', ...c });
    }
    // Si cayó la principal queda una sola lectura: no hay con qué contrastarla.
    if (deBluelytics) return armar(deBluelytics, 'bluelytics.com.ar', { estado: 'sin contraste' });

    return { estado: 'error', oficial: null, blue: null, brecha: null, contraste: { estado: 'sin contraste' } };
  }

  // --- Uruguay ---
  // Se pide una ventana de días porque el BCU publica por día hábil: un feriado
  // o un fin de semana largo dejarían la consulta de un solo día sin resultado.
  async function bcu(etiqueta, moneda, banda, dias = 10) {
    const hoy = new Date();
    const desde = new Date(hoy.getTime() - dias * 86400_000).toISOString().slice(0, 10);
    const sobre = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cot="Cotiza">
  <soapenv:Body><cot:wsbcucotizaciones.Execute><cot:Entrada>
    <cot:Moneda><cot:item>${moneda}</cot:item></cot:Moneda>
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
      const leido = interpretarBcu(xml, banda);
      if (leido.estado !== 'ok') anotar(`${etiqueta}: ${leido.error}`);
      return leido;
    } catch (e) {
      anotar(`${etiqueta} inalcanzable: ${e.message}`);
      return { estado: 'error', error: e.message };
    }
  }

  async function brou() {
    try {
      // json(), no pedir(): pedir() devuelve texto y el parser espera la lista ya armada.
      const lista = await json(BROU_URL);
      const leido = interpretarBrou(lista);
      if (leido.estado !== 'ok') anotar(`BROU: ${leido.error}`);
      return leido;
    } catch (e) {
      anotar(`BROU inalcanzable: ${e.message}`);
      return { estado: 'error', error: e.message };
    }
  }

  // Todo en paralelo: la corrida tiene 30 segundos de techo y en serie sobraban
  // motivos para no llegar.
  const [oro, plata, fx, br, ar, uy, bk, ui, ur] = await Promise.all([
    metal('XAU').catch((e) => { anotar(`oro: ${e.message}`); return null; }),
    metal('XAG').catch((e) => { anotar(`plata: ${e.message}`); return null; }),
    divisasVivas().catch(async (e) => {
      anotar(`divisas (Swissquote): ${e.message}`);
      return divisasDelBce().catch((e2) => { anotar(`divisas (BCE): ${e2.message}`); return null; });
    }),
    brasil(),
    argentina(),
    bcu('BCU', BCU_DOLAR, { min: UYU_MIN, max: UYU_MAX }),
    brou(),
    // La UI se publica todos los días; la UR, una vez por mes. A las dos se les
    // pide una ventana holgada para que un feriado no deje la consulta vacía.
    bcu('UI', BCU_UI, { min: UI_MIN, max: UI_MAX }),
    bcu('UR', BCU_UR, { min: UR_MIN, max: UR_MAX }, 45),
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

  return {
    actualizado: new Date().toISOString(),
    mercado,
    bcu: {
      estado: uy.estado, nombre: uy.nombre ?? null, compra: uy.compra ?? null, venta: uy.venta ?? null,
      promedio: uy.promedio ?? null, fecha: uy.fecha ?? null, error: uy.error ?? null,
    },
    // Pizarra del BROU. No es la misma cotización que la del BCU: el Central
    // publica una referencia del mercado y el banco, el precio de su ventanilla.
    // Las dos puntas van separadas, cada una con su variación, como el oficial
    // y el blue argentinos. El punto medio no se publica: es una cuenta sobre
    // un spread de más de dos pesos y nadie opera a ese precio.
    brou: {
      estado: bk.estado, fecha: bk.fecha ?? null, error: bk.error ?? null,
      fuente: 'uy.dolarapi.com',
      compra: bk.compra != null ? { valor: bk.compra } : null,
      venta: bk.venta != null ? { valor: bk.venta } : null,
    },
    // Unidades de cuenta: las calcula el INE y el BCU las publica en el mismo
    // servicio que las monedas. Se toman de ahí porque el INE no expone nada
    // que se pueda leer sin navegador.
    unidades: {
      ui: {
        estado: ui.estado, valor: ui.promedio ?? null,
        fecha: ui.fecha ?? null, error: ui.error ?? null,
      },
      ur: {
        estado: ur.estado, valor: ur.promedio ?? null,
        fecha: ur.fecha ?? null, error: ur.error ?? null,
      },
    },
    brasil: br,
    argentina: ar,
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
    brouCompra: foto.brou?.compra?.valor ?? null,
    brouVenta: foto.brou?.venta?.valor ?? null,
    ui: foto.unidades?.ui?.valor ?? null,
    ur: foto.unidades?.ur?.valor ?? null,
    bevsa: null,
    brl: foto.brasil?.valor ?? null,
    arsOficial: foto.argentina?.oficial?.promedio ?? null,
    arsBlue: foto.argentina?.blue?.promedio ?? null,
  };
}

export function tieneAlgo(punto) {
  return Object.keys(punto).some((k) => k !== 't' && punto[k] !== null && punto[k] !== undefined);
}

// --- variación en 24 horas ----------------------------------------------------
// Antes se comparaba contra la medición anterior, diez minutos atrás. Sirve para
// el oro, que se mueve todo el tiempo, pero no para el dólar del Banco Central:
// cambia una vez por día, así que 143 de cada 144 corridas daban 0 % y el
// tablero decía "no se movió" el día entero justo cuando sí se había movido.
//
// La referencia se busca por serie, porque no todas tienen la misma historia.
// Cuando una no llega a las 24 horas se usa su punto más viejo y se declara el
// lapso real: mejor decir "en 6 h" que fingir que son 24.
export const VENTANA_VARIACION = 24 * 3600 * 1000;

const DONDE_VA_LA_VARIACION = [
  ['oro',        (f) => f.mercado.oro],
  ['plata',      (f) => f.mercado.plata],
  ['dxy',        (f) => f.mercado.dxy],
  ['eurusd',     (f) => f.mercado.eurusd],
  ['usdjpy',     (f) => f.mercado.usdjpy],
  ['bcu',        (f) => f.bcu],
  ['brouCompra', (f) => f.brou?.compra],
  ['brouVenta',  (f) => f.brou?.venta],
  // La UR queda afuera a propósito: cambia una vez por mes, así que una
  // variación a 24 horas diría "0 %" todos los días y no informaría nada.
  ['ui',         (f) => f.unidades?.ui],
  ['brl',        (f) => f.brasil],
  ['arsOficial', (f) => f.argentina?.oficial],
  ['arsBlue',    (f) => f.argentina?.blue],
];

export function aplicarVariaciones(foto, punto, serie, ahora = Date.now()) {
  const objetivo = ahora - VENTANA_VARIACION;
  let masCorta = null;

  for (const [clave, donde] of DONDE_VA_LA_VARIACION) {
    const destino = donde(foto);
    if (!destino) continue;

    const valor = punto[clave];
    const ref = typeof valor === 'number' ? puntoDeReferencia(serie, clave, objetivo) : null;
    const antes = ref?.punto?.[clave];

    if (ref && typeof antes === 'number' && antes !== 0) {
      destino.variacion = +(((valor - antes) / antes) * 100).toFixed(2);
      destino.variacionDesde = ref.punto.t;
      destino.variacionCompleta = ref.completa;
      if (!ref.completa) {
        const horas = (ahora - Date.parse(ref.punto.t)) / 3600_000;
        masCorta = masCorta === null ? horas : Math.min(masCorta, horas);
      }
    } else {
      destino.variacion = null;
      destino.variacionDesde = null;
      destino.variacionCompleta = null;
    }
  }

  foto.variacionVentanaHoras = VENTANA_VARIACION / 3600_000;
  // Si alguna serie no llega a las 24 h, el encabezado tiene que poder decirlo.
  foto.variacionMasCortaHoras = masCorta === null ? null : +masCorta.toFixed(1);
  return foto;
}
