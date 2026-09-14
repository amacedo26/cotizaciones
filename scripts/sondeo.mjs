#!/usr/bin/env node
// Diagnóstico de fuentes. No escribe nada.
//
// Primero revisa las cuatro que están en producción, después los respaldos, y
// al final deja constancia de las que se descartaron y por qué, para no volver
// a probarlas de memoria dentro de seis meses.
//
//   node scripts/sondeo.mjs
// o desde Actions: workflow "Cotizaciones", modo = sondeo

import { interpretarSwissquote, interpretarBcu, interpretarDolarApi, calcularDxy } from '../lib/parseo.mjs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const resultados = [];

async function pedir(url, opciones = {}) {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    ...opciones,
    headers: { 'User-Agent': UA, Accept: 'application/json', ...(opciones.headers || {}) },
  });
  return { estado: r.status, ok: r.ok, cuerpo: await r.text() };
}

// Cada prueba dice qué valor obtuvo, no solo que respondió 200: una fuente que
// devuelve 200 con el cuerpo cambiado está rota igual, y así se nota.
async function revisar(nombre, critica, fn) {
  try {
    const valor = await fn();
    if (valor === null || valor === undefined) throw new Error('respondió, pero sin un valor utilizable');
    console.log(`  ✓ ${nombre.padEnd(34)} ${valor}`);
    resultados.push({ nombre, critica, ok: true });
  } catch (e) {
    console.log(`  ✗ ${nombre.padEnd(34)} ${e.message.slice(0, 120)}`);
    resultados.push({ nombre, critica, ok: false });
  }
}

const PARES = [['EUR', 'EUR/USD', true], ['JPY', 'USD/JPY', false], ['GBP', 'GBP/USD', true],
               ['CAD', 'USD/CAD', false], ['SEK', 'USD/SEK', false], ['CHF', 'USD/CHF', false]];

async function swissquote(par) {
  const { cuerpo, estado, ok } = await pedir(`https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${par}`);
  if (!ok) throw new Error(`HTTP ${estado}`);
  return interpretarSwissquote(JSON.parse(cuerpo));
}

console.log('\n=== EN PRODUCCIÓN ===\n');

for (const simbolo of ['XAU', 'XAG']) {
  await revisar(`gold-api ${simbolo}`, true, async () => {
    const { cuerpo, estado, ok } = await pedir(`https://api.gold-api.com/price/${simbolo}`);
    if (!ok) throw new Error(`HTTP ${estado}`);
    const d = JSON.parse(cuerpo);
    return `${d.price} USD  (${d.updatedAtReadable || d.updatedAt})`;
  });
}

const tasas = {};
for (const [moneda, par, invertido] of PARES) {
  await revisar(`swissquote ${par}`, true, async () => {
    const medio = await swissquote(par);
    if (medio !== null) tasas[moneda] = invertido ? 1 / medio : medio;
    return medio;
  });
}
await revisar('DXY calculado', true, async () => calcularDxy(tasas));

await revisar('BCU dólar uruguayo', true, async () => {
  const hoy = new Date();
  const desde = new Date(hoy.getTime() - 10 * 86400_000).toISOString().slice(0, 10);
  const { cuerpo, estado, ok } = await pedir('https://cotizaciones.bcu.gub.uy/wscotizaciones/servlet/awsbcucotizaciones', {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'Cotizaaction/AWSBCUCOTIZACIONES.Execute' },
    body: `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cot="Cotiza">
  <soapenv:Body><cot:wsbcucotizaciones.Execute><cot:Entrada>
    <cot:Moneda><cot:item>2225</cot:item></cot:Moneda>
    <cot:FechaDesde>${desde}</cot:FechaDesde>
    <cot:FechaHasta>${hoy.toISOString().slice(0, 10)}</cot:FechaHasta>
    <cot:Grupo>0</cot:Grupo>
  </cot:Entrada></cot:wsbcucotizaciones.Execute></soapenv:Body>
</soapenv:Envelope>`,
  });
  if (!ok) throw new Error(`HTTP ${estado}`);
  const r = interpretarBcu(cuerpo);
  if (r.estado !== 'ok') throw new Error(r.error);
  return `${r.promedio} UYU  (${r.fecha})`;
});

await revisar('Brasil (fxratesapi)', true, async () => {
  const { cuerpo, estado, ok } = await pedir('https://api.fxratesapi.com/latest?base=USD&currencies=BRL');
  if (!ok) throw new Error(`HTTP ${estado}`);
  const d = JSON.parse(cuerpo);
  return `${d.rates?.BRL?.toFixed(4)} BRL  (${d.date})`;
});

await revisar('Argentina (dolarapi)', true, async () => {
  const { cuerpo, estado, ok } = await pedir('https://dolarapi.com/v1/dolares');
  if (!ok) throw new Error(`HTTP ${estado}`);
  const r = interpretarDolarApi(JSON.parse(cuerpo));
  if (!r) throw new Error('no se reconocieron el oficial ni el blue');
  return `oficial ${r.oficial?.promedio}  ·  blue ${r.blue?.promedio}`;
});

console.log('\n=== RESPALDO ===\n');

await revisar('Argentina (bluelytics)', false, async () => {
  const { cuerpo, estado, ok } = await pedir('https://api.bluelytics.com.ar/v2/latest');
  if (!ok) throw new Error(`HTTP ${estado}`);
  const d = JSON.parse(cuerpo);
  return `oficial ${d.oficial?.value_avg}  ·  blue ${d.blue?.value_avg}`;
});

await revisar('BCE vía frankfurter', false, async () => {
  const { cuerpo, estado, ok } = await pedir('https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,JPY,GBP,CAD,SEK,CHF');
  if (!ok) throw new Error(`HTTP ${estado}`);
  const d = JSON.parse(cuerpo);
  return `EUR/USD ${(1 / d.rates.EUR).toFixed(4)}  (del ${d.date})`;
});

console.log('\n=== DESCARTADAS (no volver a intentarlas sin motivo) ===\n');
console.log('  BEVSA        login con MFA detrás de Cloudflare: no se puede automatizar');
console.log('  Yahoo        429 a IPs de datacenter, en query1 y query2');
console.log('  Stooq        404 en todos los símbolos, en .com y en .pl');
console.log('  goldprice    403 Forbidden');
console.log('  swissquote   no lista USD/BRL ni USD/ARS: devuelve []');
console.log('  awesomeapi   429 por cuota agotada desde IPs compartidas');

const rotas = resultados.filter((r) => !r.ok);
const criticas = rotas.filter((r) => r.critica);
console.log(`\n=== RESUMEN: ${resultados.length - rotas.length}/${resultados.length} bien ===`);
if (criticas.length) {
  console.log(`\n✗ ${criticas.length} fuente(s) EN PRODUCCIÓN caída(s): ${criticas.map((r) => r.nombre).join(', ')}`);
  process.exit(1);
}
if (rotas.length) console.log(`\n⚠ solo respaldos caídos: ${rotas.map((r) => r.nombre).join(', ')}`);
else console.log('\nTodo en orden.');
