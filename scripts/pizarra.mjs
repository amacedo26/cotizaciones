#!/usr/bin/env node
// Qué HTML entrega realmente el BROU a un fetch pelado, que es lo que corre en
// producción.
//
// Contestó una pregunta y la respuesta quedó en el diseño: la fecha que muestra
// la página NO la sirve el banco. El elemento <p id="date_paragraph"> llega
// vacío con los cuatro juegos de cabeceras que se prueban acá, y lo rellena
// JavaScript con el reloj del visitante. Tampoco hay Last-Modified. Por eso la
// guardia de frescura mira nuestro histórico y no la página.
//
// Sirve para volver a comprobarlo si algún día el banco cambia el sitio.
//
//   node scripts/pizarra.mjs
import { interpretarPizarraBrou } from '../lib/parseo.mjs';

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
    const i = html.indexOf('date_paragraph');
    if (i >= 0) {
      const trozo = html.slice(i, i + 110).replace(/\s+/g, ' ');
      console.log(`  date_paragraph: ${trozo}`);
      console.log(`  ¿lo sirve el banco con texto adentro? ${!/date_paragraph"><\/p>/.test(html)}`);
    }
  } catch (e) {
    console.log(`\n[${etiqueta}] EXCEPCIÓN: ${e.message}`);
  }
}
console.log('\nListo.');
