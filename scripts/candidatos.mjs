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

console.log('=== BRASIL: buscando una fuente VIVA ===');
// Descartadas en la ronda anterior: Swissquote no lista USD/BRL (devuelve [])
// y awesomeapi respondió 429 por cuota agotada desde la IP del runner.
await probar('fxratesapi', 'https://api.fxratesapi.com/latest?base=USD&currencies=BRL', 300);
await probar('currency-api (jsdelivr)', 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json', 200);
await probar('currency-api (pages.dev)', 'https://latest.currency-api.pages.dev/v1/currencies/usd.json', 200);
await probar('open.er-api', 'https://open.er-api.com/v6/latest/USD', 200);
await probar('frankfurter BRL', 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=BRL', 200);
await probar('awesomeapi (reintento)', 'https://economia.awesomeapi.com.br/json/last/USD-BRL', 300);
// PTAX intradía: el Banco Central publica varios boletines por día, no uno solo
await probar('BCB PTAX del día', "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)?@dataCotacao='09-14-2026'&$format=json", 400);

console.log('\n\n=== ARGENTINA ===');
await probar('dolarapi.com', 'https://dolarapi.com/v1/dolares', 700);
await probar('bluelytics', 'https://api.bluelytics.com.ar/v2/latest', 400);
await probar('swissquote USD/ARS', 'https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/USD/ARS', 200);
await probar('criptoya (referencia)', 'https://criptoya.com/api/dolar', 400);

console.log('\n\nExploración terminada.');
