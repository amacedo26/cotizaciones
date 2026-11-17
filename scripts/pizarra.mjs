#!/usr/bin/env node
// Qué HTML entrega realmente el BROU a un fetch pelado, que es lo que corre en
// producción. Nació para contestar una pregunta concreta: la tabla se lee bien
// pero la fecha de la página no aparece, y hay que ver si llega o no llega.
//
//   node scripts/pizarra.mjs
import { interpretarPizarraBrou, fechaDePizarra } from '../lib/parseo.mjs';

const URL_BROU = 'https://www.brou.com.uy/cotizaciones';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const INTENTOS = [
  ['tal cual lo pide producción', { 'User-Agent': UA }],
  ['con Accept-Language es-UY', { 'User-Agent': UA, 'Accept-Language': 'es-UY,es;q=0.9' }],
  ['con Accept de navegador', { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-UY,es;q=0.9' }],
  ['sin User-Agent', {}],
];

for (const [etiqueta, headers] of INTENTOS) {
  try {
    const r = await fetch(URL_BROU, { headers, signal: AbortSignal.timeout(20000) });
    const html = await r.text();
    const leido = interpretarPizarraBrou(html);
    console.log(`\n[${etiqueta}] ${r.status} ${(r.headers.get('content-type') || '?').split(';')[0]} · ${html.length} bytes`);
    console.log(`  last-modified: ${r.headers.get('last-modified') || '—'} · date: ${r.headers.get('date') || '—'}`);
    console.log(`  cotización: ${leido.estado === 'ok' ? `${leido.compra} / ${leido.venta}` : leido.error}`);
    console.log(`  ¿está date_paragraph?  ${html.includes('date_paragraph')}`);
    console.log(`  ¿está "de Noviembre de"? ${html.includes('de Noviembre de')}`);
    console.log(`  fechaDePizarra: ${fechaDePizarra(html)}`);
    const i = html.indexOf('date_paragraph');
    if (i >= 0) console.log('  contexto: ' + html.slice(i, i + 110).replace(/\s+/g, ' '));
  } catch (e) {
    console.log(`\n[${etiqueta}] EXCEPCIÓN: ${e.message}`);
  }
}
console.log('\nListo.');
