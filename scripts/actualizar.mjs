#!/usr/bin/env node
// Actualiza los datos del tablero de cotizaciones.
// Sin dependencias: requiere Node 20+ (fetch nativo).
//
//   node actualizar.mjs          consulta las fuentes y escribe los archivos
//   node actualizar.mjs --dry    consulta e imprime, sin escribir nada
//
// Las fuentes están elegidas por una razón concreta: fueron las únicas que
// respondieron desde un runner de GitHub Actions. Yahoo Finance devuelve 429 y
// Stooq 404 a IPs de datacenter, y BEVSA exige login con MFA detrás de
// Cloudflare. Ver README para el detalle y para reproducir el sondeo.

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aNumero, interpretarBevsa, interpretarBcu, interpretarSwissquote, calcularDxy, podar } from './parseo.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOLO_LECTURA = process.argv.includes('--dry');
// El servidor local corre esto cada pocos minutos y escribe archivos aparte,
// sin versionar: así nunca choca con lo que deja el robot en el repositorio.
const LOCAL = process.env.SALIDA_LOCAL === '1';
const suf = (base, ext) => join(DIR, LOCAL ? `${base}.local.${ext}` : `${base}.${ext}`);
const TIMEOUT = 20_000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const BCU_URL = 'https://cotizaciones.bcu.gub.uy/wscotizaciones/servlet/awsbcucotizaciones';
const BCU_MONEDA = 2225; // DLS. USA BILLETE
const BEVSA_URL = 'https://dolaronline.bevsa.com.uy/Dolar/DataDolarNuevo';

const incidencias = [];
const anotar = (msg) => { incidencias.push(msg); console.warn('  ! ' + msg); };

async function pedir(url, opciones = {}) {
  const r = await fetch(url, {
    ...opciones,
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { 'User-Agent': UA, ...(opciones.headers || {}) },
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${new URL(url).host} — ${texto.slice(0, 150)}`);
  return texto;
}

// --- metales ----------------------------------------------------------------
async function metal(simbolo) {
  const d = JSON.parse(await pedir(`https://api.gold-api.com/price/${simbolo}`, { headers: { Accept: 'application/json' } }));
  const precio = aNumero(d?.price);
  if (precio === null) throw new Error(`respuesta sin precio para ${simbolo}`);
  return { precio, momento: d.updatedAt ?? null, fuente: 'gold-api.com' };
}

// --- divisas ----------------------------------------------------------------
// Swissquote publica precios vivos, que es lo que hace falta para un tablero
// que se mira seguido. El BCE queda de respaldo: es fiable pero publica una
// sola vez por día hábil, así que con él las divisas parecen congeladas.
const PARES_DXY = [
  ['EUR', 'EUR/USD', true],   // invertido: la fuente lo cotiza en dólares por euro
  ['JPY', 'USD/JPY', false],
  ['GBP', 'GBP/USD', true],
  ['CAD', 'USD/CAD', false],
  ['SEK', 'USD/SEK', false],
  ['CHF', 'USD/CHF', false],
];

async function divisasVivas() {
  const tasas = {};   // moneda por dólar, que es lo que consume el cálculo del DXY
  const directo = {}; // como lo cotiza el mercado, que es lo que se muestra
  for (const [moneda, par, invertido] of PARES_DXY) {
    const cuerpo = await pedir(
      `https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${par}`,
      { headers: { Accept: 'application/json' } },
    );
    const medio = interpretarSwissquote(JSON.parse(cuerpo));
    if (medio === null) throw new Error(`sin precio para ${par}`);
    directo[par] = medio;
    tasas[moneda] = invertido ? 1 / medio : medio;
  }
  return { tasas, directo, momento: new Date().toISOString(), fuente: 'Swissquote' };
}

async function divisasDelBce() {
  const d = JSON.parse(await pedir(
    'https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,JPY,GBP,CAD,SEK,CHF',
    { headers: { Accept: 'application/json' } },
  ));
  if (!d?.rates) throw new Error('respuesta sin tasas');
  const eur = aNumero(d.rates.EUR);
  return {
    tasas: d.rates,
    directo: { 'EUR/USD': eur ? +(1 / eur).toFixed(6) : null, 'USD/JPY': aNumero(d.rates.JPY) },
    momento: d.date ?? null, // fecha sin hora: el BCE publica un valor por día
    fuente: 'BCE vía frankfurter.dev',
  };
}

async function traerMercado() {
  const mercado = {};
  const guardar = (id, nombre, unidad, datos) => {
    mercado[id] = datos
      ? { nombre, unidad, estado: 'ok', ...datos }
      : { nombre, unidad, estado: 'error', precio: null, fuente: null, momento: null };
  };

  for (const [id, simbolo, nombre] of [['oro', 'XAU', 'Oro'], ['plata', 'XAG', 'Plata']]) {
    try { guardar(id, nombre, 'USD / onza troy', await metal(simbolo)); }
    catch (e) { anotar(`${id}: ${e.message}`); guardar(id, nombre, 'USD / onza troy', null); }
  }

  let fx = null;
  for (const intento of [divisasVivas, divisasDelBce]) {
    try { fx = await intento(); break; }
    catch (e) { anotar(`divisas (${intento.name}): ${e.message}`); }
  }

  if (!fx) {
    for (const [id, nombre, unidad] of [
      ['eurusd', 'EUR / USD', 'dólares por euro'],
      ['usdjpy', 'USD / JPY', 'yenes por dólar'],
      ['dxy', 'Índice dólar (DXY)', 'puntos — calculado'],
    ]) guardar(id, nombre, unidad, null);
    return mercado;
  }

  const { tasas, directo, momento, fuente } = fx;
  guardar('eurusd', 'EUR / USD', 'dólares por euro',
    directo['EUR/USD'] ? { precio: +directo['EUR/USD'].toFixed(4), fuente, momento } : null);
  guardar('usdjpy', 'USD / JPY', 'yenes por dólar',
    directo['USD/JPY'] ? { precio: +directo['USD/JPY'].toFixed(2), fuente, momento } : null);
  const dxy = calcularDxy(tasas);
  guardar('dxy', 'Índice dólar (DXY)', 'puntos — calculado',
    dxy ? { precio: dxy, fuente: `calculado sobre ${fuente}`, momento, calculado: true } : null);
  if (!dxy) anotar('dxy: faltó alguna moneda de la canasta, no se pudo calcular');

  return mercado;
}

// --- dólar uruguayo: Banco Central ------------------------------------------
async function traerBcu() {
  const hoy = new Date();
  // se pide una ventana de días porque el BCU publica por día hábil: un feriado
  // o un fin de semana largo dejarían la consulta de un solo día sin resultado
  const desde = new Date(hoy.getTime() - 10 * 86400_000).toISOString().slice(0, 10);
  const hasta = hoy.toISOString().slice(0, 10);
  const sobre = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cot="Cotiza">
  <soapenv:Body>
    <cot:wsbcucotizaciones.Execute>
      <cot:Entrada>
        <cot:Moneda><cot:item>${BCU_MONEDA}</cot:item></cot:Moneda>
        <cot:FechaDesde>${desde}</cot:FechaDesde>
        <cot:FechaHasta>${hasta}</cot:FechaHasta>
        <cot:Grupo>0</cot:Grupo>
      </cot:Entrada>
    </cot:wsbcucotizaciones.Execute>
  </soapenv:Body>
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

// --- dólar uruguayo: BEVSA (opcional) ---------------------------------------
// BEVSA exige sesión autenticada, con MFA y Cloudflare adelante: no se puede
// automatizar el login. Queda como extra manual: si alguien pega una cookie de
// sesión válida en el secreto BEVSA_COOKIE, se usa hasta que expire. Sin ese
// secreto, este módulo no hace nada y el tablero funciona igual con el BCU.
async function traerBevsa() {
  const galleta = process.env.BEVSA_COOKIE;
  if (!galleta) return { estado: 'apagado' };
  try {
    const crudo = await pedir(BEVSA_URL, {
      redirect: 'manual',
      headers: {
        Cookie: galleta,
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: 'https://dolaronline.bevsa.com.uy/',
      },
    });
    let payload = JSON.parse(crudo);
    if (typeof payload === 'string') payload = JSON.parse(payload);
    const leido = interpretarBevsa(payload);
    if (leido.estado !== 'ok') anotar('BEVSA: respondió pero no se reconoció ninguna cotización');
    return { ...leido, crudo };
  } catch (e) {
    anotar(`BEVSA: la cookie no sirve o expiró (${e.message.slice(0, 80)})`);
    return { estado: 'error', error: 'cookie inválida o expirada' };
  }
}

function leerJSON(ruta, porDefecto) {
  if (!existsSync(ruta)) return porDefecto;
  try { return JSON.parse(readFileSync(ruta, 'utf8')); }
  catch { anotar(`${ruta} ilegible, se reinicia`); return porDefecto; }
}

// --- main -------------------------------------------------------------------
console.log('Consultando metales y divisas...');
const mercado = await traerMercado();
console.log('Consultando el Banco Central...');
const bcu = await traerBcu();
const bevsa = await traerBevsa();

// en modo local la serie propia manda; si aún no existe, arranca de la del repo
const previo = LOCAL
  ? leerJSON(suf('historico', 'json'), leerJSON(join(DIR, 'historico.json'), []))
  : leerJSON(join(DIR, 'historico.json'), []);
const anterior = previo.length ? previo[previo.length - 1] : null;

const ahora = new Date().toISOString();
const punto = {
  t: ahora,
  oro: mercado.oro?.precio ?? null,
  plata: mercado.plata?.precio ?? null,
  dxy: mercado.dxy?.precio ?? null,
  eurusd: mercado.eurusd?.precio ?? null,
  usdjpy: mercado.usdjpy?.precio ?? null,
  bcu: bcu.promedio ?? null,
  bevsa: bevsa.promedio ?? null,
};

// La variación se calcula contra la corrida anterior propia, no contra el
// cierre del día: ninguna de estas fuentes gratuitas publica el previo.
for (const [id, dato] of Object.entries(mercado)) {
  const antes = anterior?.[id];
  dato.variacion = dato.precio && typeof antes === 'number' && antes
    ? +(((dato.precio - antes) / antes) * 100).toFixed(2)
    : null;
}

const uyu = bevsa.promedio ?? bcu.promedio ?? null;
const oro = mercado.oro?.precio ?? null;

const snapshot = {
  actualizado: ahora,
  mercado,
  bcu: {
    estado: bcu.estado, nombre: bcu.nombre ?? null, compra: bcu.compra ?? null,
    venta: bcu.venta ?? null, promedio: bcu.promedio ?? null,
    fecha: bcu.fecha ?? null, error: bcu.error ?? null,
  },
  bevsa: {
    estado: bevsa.estado, compra: bevsa.compra ?? null, venta: bevsa.venta ?? null,
    promedio: bevsa.promedio ?? null, fecha: bevsa.fecha ?? null, error: bevsa.error ?? null,
  },
  // Calculado acá, no tomado de ninguna fuente: cruce del oro (USD/oz) con el
  // dólar uruguayo de esta misma corrida. No es una cotización de mercado.
  derivado: {
    baseDolar: bevsa.promedio ? 'BEVSA' : bcu.promedio ? 'BCU' : null,
    oroEnPesosPorOnza: oro && uyu ? +(oro * uyu).toFixed(2) : null,
    oroEnPesosPorGramo: oro && uyu ? +((oro / 31.1035) * uyu).toFixed(2) : null,
  },
  incidencias,
};

// Si no se obtuvo ni un valor, no se agrega el punto: una corrida fallida no
// debe dejar un hueco de nulls en la serie.
const sirve = Object.keys(punto).some((k) => k !== 't' && punto[k] !== null);
if (!sirve) anotar('ninguna fuente respondió: no se agrega punto al histórico');
const historico = podar(sirve ? [...previo, punto] : previo);

if (SOLO_LECTURA) {
  console.log(JSON.stringify({ snapshot, punto }, null, 2));
  process.exit(0);
}

// En modo local, escribir un snapshot vacío sería peor que no escribir nada:
// al ser el más reciente, la página lo preferiría y taparía datos buenos con
// "sin dato". Si no se obtuvo nada, se conserva lo anterior.
if (LOCAL && !sirve) {
  console.log('Local: ninguna fuente respondió, se conserva el dato anterior.');
  process.exit(2); // el servidor lo reporta como fallo en /estado
}

const paquete = { ...snapshot, historico };
writeFileSync(suf('historico', 'json'), JSON.stringify(historico));
writeFileSync(suf('datos', 'json'), JSON.stringify(paquete, null, 2));
writeFileSync(suf('datos', 'js'),
  `window.${LOCAL ? '__COTIZACIONES_LOCAL__' : '__COTIZACIONES__'} = ${JSON.stringify(paquete)};\n`);
if (bevsa.crudo) writeFileSync(join(DIR, 'raw-bevsa.json'), bevsa.crudo);

console.log(`Listo${LOCAL ? ' (local)' : ''}. ${historico.length} puntos en el histórico. Incidencias: ${incidencias.length}`);
