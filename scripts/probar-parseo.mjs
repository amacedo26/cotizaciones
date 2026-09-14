#!/usr/bin/env node
// Prueba el parser contra formas plausibles de respuesta, sin tocar la red.
//   node scripts/probar-parseo.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aNumero, interpretarBevsa, interpretarBcu, calcularDxy, podar } from './parseo.mjs';

test('aNumero entiende los formatos de número que puede mandar el endpoint', () => {
  assert.equal(aNumero(41.25), 41.25);
  assert.equal(aNumero('41,25'), 41.25);
  assert.equal(aNumero('41.25'), 41.25);
  assert.equal(aNumero('1.234,56'), 1234.56);
  assert.equal(aNumero('1,234.56'), 1234.56);
  assert.equal(aNumero('$ 41,25'), 41.25);
  assert.equal(aNumero('s/d'), null);
  assert.equal(aNumero(null), null);
});

test('objeto plano con compra y venta', () => {
  const r = interpretarBevsa({ Compra: '41,25', Venta: '41,75', Fecha: '2026-09-14T12:00:00' });
  assert.equal(r.estado, 'ok');
  assert.equal(r.compra, 41.25);
  assert.equal(r.venta, 41.75);
  assert.equal(r.promedio, 41.5); // calculado, porque no vino promedio
  assert.equal(r.fecha, '2026-09-14T12:00:00');
});

test('promedio explícito gana sobre el calculado', () => {
  const r = interpretarBevsa({ compra: 41.2, venta: 41.8, promedio: 41.55 });
  assert.equal(r.promedio, 41.55);
});

test('respuesta anidada en arreglo, estilo tabla', () => {
  const r = interpretarBevsa({
    data: [{ Id: 1, Moneda: 'USD', PrecioCompra: 41.1, PrecioVenta: 41.6, Volumen: 12500000 }],
  });
  assert.equal(r.estado, 'ok');
  assert.equal(r.compra, 41.1);
  assert.equal(r.venta, 41.6);
  assert.equal(r.origenCampos.compra, 'data[0].PrecioCompra');
});

test('ignora ids y volúmenes fuera del rango del peso', () => {
  const r = interpretarBevsa({ IdCompra: 7, IdVenta: 9, Compra: 41.3, Venta: 41.9 });
  assert.equal(r.compra, 41.3);
  assert.equal(r.venta, 41.9);
});

test('solo última cotización, sin compra ni venta', () => {
  const r = interpretarBevsa({ UltimaCotizacion: '41,44', Hora: '15:30' });
  assert.equal(r.estado, 'ok');
  assert.equal(r.promedio, 41.44);
});

test('respuesta irreconocible marca revisar y conserva los campos', () => {
  const r = interpretarBevsa({ ok: true, mensaje: 'sin datos', total: 0 });
  assert.equal(r.estado, 'revisar');
  assert.equal(r.promedio, null);
  assert.deepEqual(Object.keys(r.campos), ['ok', 'mensaje', 'total']);
});

test('podar conserva los 90 días recientes y un punto por día en lo viejo', () => {
  const ahora = Date.parse('2026-09-14T00:00:00Z');
  const dia = 24 * 3600 * 1000;
  const serie = [
    { t: new Date(ahora - 200 * dia).toISOString(), bevsa: 1 },
    { t: new Date(ahora - 200 * dia + 3600e3).toISOString(), bevsa: 2 },
    { t: new Date(ahora - 10 * dia).toISOString(), bevsa: 3 },
    { t: new Date(ahora - 10 * dia + 3600e3).toISOString(), bevsa: 4 },
  ];
  const r = podar(serie, ahora);
  assert.equal(r.length, 3); // los dos viejos colapsan en uno, los recientes quedan
  assert.equal(r[0].bevsa, 2);
  assert.deepEqual(r.slice(1).map((p) => p.bevsa), [3, 4]);
});

// La forma de este XML está copiada de la respuesta real del servicio,
// registrada con scripts/sondeo.mjs desde un runner de GitHub Actions.
const SOAP_BCU = `<?xml version="1.0" encoding="utf-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
 <SOAP-ENV:Body><wsbcucotizaciones.ExecuteResponse xmlns="Cotiza"><Salida xmlns="Cotiza">
  <respuestastatus><status>1</status><codigoerror>0</codigoerror><mensaje/></respuestastatus>
  <datoscotizaciones>
   <datoscotizaciones.dato xmlns="Cotiza">
    <Fecha>2026-09-04</Fecha><Moneda>2225</Moneda><Nombre>DLS. USA BILLETE</Nombre>
    <TCC>40.243000</TCC><TCV>40.643000</TCV>
   </datoscotizaciones.dato>
   <datoscotizaciones.dato xmlns="Cotiza">
    <Fecha>2026-09-11</Fecha><Moneda>2225</Moneda><Nombre>DLS. USA BILLETE</Nombre>
    <TCC>40.100000</TCC><TCV>40.500000</TCV>
   </datoscotizaciones.dato>
  </datoscotizaciones>
 </Salida></wsbcucotizaciones.ExecuteResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

test('BCU: se queda con el registro más reciente, no con el primero', () => {
  const r = interpretarBcu(SOAP_BCU);
  assert.equal(r.estado, 'ok');
  assert.equal(r.fecha, '2026-09-11');       // el primero del XML es el 09-04
  assert.equal(r.compra, 40.1);
  assert.equal(r.venta, 40.5);
  assert.equal(r.promedio, 40.3);
  assert.equal(r.nombre, 'DLS. USA BILLETE');
  assert.equal(r.registros, 2);
});

test('BCU: status distinto de 1 es un error, no un cero', () => {
  const r = interpretarBcu(SOAP_BCU.replace('<status>1</status>', '<status>0</status>')
                                   .replace('<mensaje/>', '<mensaje>fecha invalida</mensaje>'));
  assert.equal(r.estado, 'error');
  assert.match(r.error, /fecha invalida/);
});

test('BCU: respuesta vacía o basura no revienta', () => {
  assert.equal(interpretarBcu('').estado, 'error');
  assert.equal(interpretarBcu(null).estado, 'error');
  assert.equal(interpretarBcu('<html>error 500</html>').estado, 'error');
});

test('DXY: reproduce el valor esperado con las tasas del BCE', () => {
  // tasas reales del 2026-09-11; el cálculo a mano con la fórmula oficial da 99,17
  const dxy = calcularDxy({ EUR: 0.86266, JPY: 154.04, GBP: 0.7403, CAD: 1.3858, SEK: 9.694, CHF: 0.8153 });
  assert.ok(Math.abs(dxy - 99.17) < 0.01, `esperaba ~99.17, dio ${dxy}`);
});

test('DXY: sin la canasta completa devuelve null en vez de un número inventado', () => {
  assert.equal(calcularDxy({ EUR: 0.86, JPY: 154 }), null);
  assert.equal(calcularDxy({}), null);
  assert.equal(calcularDxy(null), null);
});
