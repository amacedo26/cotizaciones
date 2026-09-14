#!/usr/bin/env node
// Sonda de diagnóstico: prueba fuentes candidatas desde donde corra y reporta
// qué responde cada una. No escribe nada.
//
// Esta ronda busca divisas INTRADÍA: las tasas del BCE se publican una vez por
// día hábil y no sirven para un tablero que se mira cada hora.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function probar(etiqueta, url, largo = 240) {
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

console.log('=== Swissquote: ya respondió para XAU/USD, probar los pares de la canasta DXY ===');
for (const par of ['EUR/USD', 'USD/JPY', 'GBP/USD', 'USD/CAD', 'USD/SEK', 'USD/CHF']) {
  const cuerpo = await probar(`swissquote ${par}`, `https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${par}`, 160);
  try {
    const perfiles = JSON.parse(cuerpo)?.[0]?.spreadProfilePrices || [];
    const p = perfiles.find((x) => x.spreadProfile === 'prime') || perfiles[0];
    if (p) console.log(`  => medio: ${((p.bid + p.ask) / 2).toFixed(5)}`);
  } catch { /* ya se reportó arriba */ }
}

console.log('\n\n=== Otros candidatos intradía ===');
await probar('gold-api EUR', 'https://api.gold-api.com/price/EUR', 200);
await probar('coinbase EUR-USD', 'https://api.coinbase.com/v2/exchange-rates?currency=USD', 200);
await probar('exchangerate.host', 'https://api.exchangerate.host/live?source=USD', 200);

console.log('\n\nSondeo terminado.');
