#!/usr/bin/env node
// Sonda de diagnóstico: prueba fuentes candidatas desde donde corra y reporta
// qué responde cada una. No escribe nada. Sirve para decidir con datos en vez
// de suposiciones, sobre todo porque las fuentes gratuitas bloquean IPs de
// datacenter y lo que anda desde una laptop puede fallar en un runner.
//
//   node scripts/sondeo.mjs

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const BCU = 'https://cotizaciones.bcu.gub.uy/wscotizaciones/servlet/awsbcucotizaciones';

async function probar(etiqueta, url, opciones = {}, largo = 200) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(25000), ...opciones,
      headers: { 'User-Agent': UA, ...(opciones.headers || {}) } });
    const cuerpo = await r.text();
    console.log(`\n[${etiqueta}] ${r.status} ${(r.headers.get('content-type') || '?').split(';')[0]}`);
    if (largo) console.log('  ' + cuerpo.replace(/\s+/g, ' ').slice(0, largo));
    return { ok: r.ok, cuerpo };
  } catch (e) {
    console.log(`\n[${etiqueta}] EXCEPCIÓN: ${e.message}`);
    return { ok: false, cuerpo: '' };
  }
}

console.log('=== BCU: volcado del contrato ===');
const wsdl = await probar('wsdl', BCU + '?WSDL', {}, 0);
// El WSDL de GeneXus define los mensajes como <part> y <element>; se vuelca
// entero (recortado) porque adivinar los nombres es lo que rompe estas cosas.
console.log(wsdl.cuerpo.replace(/>\s+</g, '>\n<').slice(0, 3500));

console.log('\n\n=== BCU: intento de pedido real ===');
const hoy = new Date();
const desde = new Date(hoy.getTime() - 10 * 24 * 3600 * 1000).toISOString().slice(0, 10);
const hasta = hoy.toISOString().slice(0, 10);

// 2225 = dólar billete; 501 = dólar interbancario (a confirmar con la respuesta)
function sobre(elemento, moneda) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cot="Cotiza">
  <soapenv:Body>
    <cot:${elemento}>
      <cot:Entrada>
        <cot:Moneda><cot:item>${moneda}</cot:item></cot:Moneda>
        <cot:FechaDesde>${desde}</cot:FechaDesde>
        <cot:FechaHasta>${hasta}</cot:FechaHasta>
        <cot:Grupo>0</cot:Grupo>
      </cot:Entrada>
    </cot:${elemento}>
  </soapenv:Body>
</soapenv:Envelope>`;
}

for (const elemento of ['wsbcucotizaciones.Execute', 'AWSBCUCOTIZACIONES.Execute', 'Execute']) {
  await probar(`soap ${elemento}`, BCU, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'Cotizaaction/AWSBCUCOTIZACIONES.Execute' },
    body: sobre(elemento, 2225),
  }, 700);
}

console.log('\n\n=== Oro y plata: confirmar símbolos ===');
await probar('gold-api XAU', 'https://api.gold-api.com/price/XAU', { headers: { Accept: 'application/json' } }, 250);
await probar('gold-api XAG', 'https://api.gold-api.com/price/XAG', { headers: { Accept: 'application/json' } }, 250);

console.log('\n\nSondeo terminado.');
