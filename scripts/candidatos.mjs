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


// --- Ronda 2: BROU y las unidades de cuenta uruguayas (UI y UR) ---

const BCU_WS = 'https://cotizaciones.bcu.gub.uy/wscotizaciones/servlet/';

async function soap(etiqueta, servlet, accion, cuerpo, largo = 900) {
  const sobre = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cot="Cotiza">
  <soapenv:Body>${cuerpo}</soapenv:Body>
</soapenv:Envelope>`;
  try {
    const r = await fetch(BCU_WS + servlet, {
      method: 'POST',
      signal: AbortSignal.timeout(25000),
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: accion },
      body: sobre,
    });
    const xml = await r.text();
    console.log(`\n[${etiqueta}] ${r.status} ${(r.headers.get('content-type') || '?').split(';')[0]} (${xml.length} bytes)`);
    console.log('  ' + xml.replace(/\s+/g, ' ').slice(0, largo));
    return xml;
  } catch (e) {
    console.log(`\n[${etiqueta}] EXCEPCIÓN: ${e.message}`);
    return '';
  }
}

function cotizacionesDe(codigo, dias = 45) {
  const hoy = new Date();
  const desde = new Date(hoy.getTime() - dias * 86400_000).toISOString().slice(0, 10);
  return `<cot:wsbcucotizaciones.Execute><cot:Entrada>
    <cot:Moneda><cot:item>${codigo}</cot:item></cot:Moneda>
    <cot:FechaDesde>${desde}</cot:FechaDesde>
    <cot:FechaHasta>${hoy.toISOString().slice(0, 10)}</cot:FechaHasta>
    <cot:Grupo>0</cot:Grupo>
  </cot:Entrada></cot:wsbcucotizaciones.Execute>`;
}

console.log('\n\n=== URUGUAY: dólar BROU ===');
// El sitio del BROU es un portal Liferay; puede no servir nada legible sin navegador.
await probar('uy.dolarapi cotizaciones', 'https://uy.dolarapi.com/v1/cotizaciones', 900);
await probar('uy.dolarapi brou', 'https://uy.dolarapi.com/v1/cotizaciones/brou', 400);
const html = await probar('brou.com.uy (HTML crudo)', 'https://www.brou.com.uy/cotizaciones', 400);
if (html) {
  // Si el portal sirve el número en el HTML, aparecerá cerca de la palabra "Dólar".
  const cerca = [...html.matchAll(/[Dd][óo]lar[\s\S]{0,400}?(\d{1,3}[.,]\d{2})/g)].slice(0, 6);
  console.log('  números cerca de "Dólar":', cerca.map((m) => m[1]).join(' | ') || 'ninguno');
  console.log('  ¿trae JSON embebido?', /application\/json|window\.__|data-cotiza/i.test(html));
}
await probar('brou web/guest', 'https://www.brou.com.uy/web/guest/cotizaciones', 300);

console.log('\n\n=== URUGUAY: UI y UR ===');
// Primero el catálogo: así los códigos salen del propio BCU y no de la memoria.
const monedas = await soap('BCU catálogo de monedas', 'awsbcumonedas', 'Cotiza/AWSBCUMONEDAS.Execute',
  '<cot:wsbcumonedas.Execute><cot:Entrada><cot:Grupo>0</cot:Grupo></cot:Entrada></cot:wsbcumonedas.Execute>', 400);
if (monedas) {
  const pares = [...monedas.matchAll(/<Codigo>(\d+)<\/Codigo>\s*<Nombre>([^<]*)<\/Nombre>/g)]
    .map((m) => `${m[1]}=${m[2].trim()}`);
  console.log(`  ${pares.length} monedas:`, pares.join(' · ').slice(0, 1400));
}
for (const codigo of [9800, 9900, 9700, 500]) {
  await soap(`BCU moneda ${codigo}`, 'awsbcucotizaciones', 'Cotizaaction/AWSBCUCOTIZACIONES.Execute', cotizacionesDe(codigo), 700);
}
await probar('INE portada', 'https://www.ine.gub.uy/', 200);
await probar('INE UI (portal)', 'https://www.ine.gub.uy/web/guest/unidad-indexada', 200);
await probar('INE UR (portal)', 'https://www.ine.gub.uy/web/guest/unidad-reajustable', 200);


console.log('\n\nExploración terminada.');
