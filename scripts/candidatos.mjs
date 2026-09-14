#!/usr/bin/env node
// Explora fuentes NUEVAS, antes de decidir si entran al tablero.
// Separado de sondeo.mjs a propósito: aquel verifica lo que está en producción
// y debe fallar si algo se cae; este es exploratorio y nunca falla.
//
//   node scripts/candidatos.mjs

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function probar(etiqueta, url, largo = 320) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': UA, Accept: 'application/json' } });
    const cuerpo = await r.text();
    console.log(`\n[${etiqueta}] ${r.status} ${(r.headers.get('content-type') || '?').split(';')[0]}`);
    console.log('  ' + cuerpo.replace(/\s+/g, ' ').slice(0, largo));
    return cuerpo;
  } catch (e) {
    console.log(`\n[${etiqueta}] EXCEPCIÓN: ${e.message}`);
    return '';
  }
}

console.log('=== BRASIL ===');
const sq = await probar('swissquote USD/BRL', 'https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/USD/BRL', 200);
try {
  const p = JSON.parse(sq)?.[0]?.spreadProfilePrices?.[0];
  if (p) console.log(`  => medio: ${((p.bid + p.ask) / 2).toFixed(4)}`);
} catch { /* ya reportado */ }
await probar('awesomeapi USD-BRL', 'https://economia.awesomeapi.com.br/json/last/USD-BRL', 300);
await probar('BCB PTAX (oficial)', "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@dataInicial='09-01-2026'&@dataFinalCotacao='09-14-2026'&$top=3&$orderby=dataHoraCotacao%20desc&$format=json", 400);

console.log('\n\n=== ARGENTINA ===');
await probar('dolarapi.com', 'https://dolarapi.com/v1/dolares', 700);
await probar('bluelytics', 'https://api.bluelytics.com.ar/v2/latest', 400);
await probar('swissquote USD/ARS', 'https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/USD/ARS', 200);
await probar('criptoya (referencia)', 'https://criptoya.com/api/dolar', 400);

console.log('\n\nExploración terminada.');
