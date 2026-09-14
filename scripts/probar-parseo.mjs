#!/usr/bin/env node
// Prueba el parser contra formas plausibles de respuesta, sin tocar la red.
//   node scripts/probar-parseo.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aNumero, interpretarBevsa, interpretarBcu, interpretarSwissquote, interpretarDolarApi,
         interpretarBluelytics, calcularBrecha, calcularDxy, podar } from './parseo.mjs';

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

// Forma real de la respuesta, registrada con scripts/sondeo.mjs el 2026-09-14.
test('Swissquote: toma el medio del perfil con spread más ajustado', () => {
  const r = interpretarSwissquote([{
    topo: { platform: 'SwissquoteLtd', server: 'Live5' },
    spreadProfilePrices: [
      { spreadProfile: 'premium', bid: 1.15558, ask: 1.15572 },  // spread 0.00014
      { spreadProfile: 'prime',   bid: 1.15560, ask: 1.15570 },  // spread 0.00010, gana
      { spreadProfile: 'elite',   bid: 1.15550, ask: 1.15580 },
    ],
  }]);
  assert.equal(r, 1.15565);
});

test('Swissquote: un solo perfil, como devuelve la plataforma AT', () => {
  const r = interpretarSwissquote([{
    topo: { platform: 'AT', server: 'AT' },
    spreadProfilePrices: [{ spreadProfile: 'standard', bid: 0.81623, ask: 0.81644 }],
  }]);
  assert.ok(Math.abs(r - 0.816335) < 1e-6, `dio ${r}`);
});

test('Swissquote: respuestas rotas devuelven null, no un precio inventado', () => {
  assert.equal(interpretarSwissquote([]), null);
  assert.equal(interpretarSwissquote(null), null);
  assert.equal(interpretarSwissquote([{ spreadProfilePrices: [] }]), null);
  assert.equal(interpretarSwissquote([{ spreadProfilePrices: [{ bid: null, ask: 1.2 }] }]), null);
  assert.equal(interpretarSwissquote([{ spreadProfilePrices: [{ bid: 0, ask: 0 }] }]), null);
});

test('DXY con las cotizaciones vivas de Swissquote', () => {
  // valores del sondeo del 2026-09-14 19:01 UTC, convertidos a "moneda por dólar"
  const dxy = calcularDxy({
    EUR: 1 / 1.15565, JPY: 154.0765, GBP: 1 / 1.35113,
    CAD: 1.39019, SEK: 9.7417, CHF: 0.81634,
  });
  assert.ok(dxy > 95 && dxy < 105, `fuera del rango razonable: ${dxy}`);
  console.log('    DXY con datos vivos:', dxy);
});

// Formas reales registradas con scripts/candidatos.mjs el 2026-09-14.
const DOLARAPI = [
  { moneda: 'USD', casa: 'oficial', nombre: 'Oficial', compra: 1480, venta: 1530, fechaActualizacion: '2026-09-14T16:00:00.000Z' },
  { moneda: 'USD', casa: 'blue', nombre: 'Blue', compra: 1535, venta: 1555, fechaActualizacion: '2026-09-14T18:58:00.000Z' },
  { moneda: 'USD', casa: 'bolsa', nombre: 'Bolsa', compra: 1532.3, venta: 1533.4, fechaActualizacion: '2026-09-14T18:58:00.000Z' },
  { moneda: 'USD', casa: 'mayorista', nombre: 'Mayorista', compra: 1501, venta: 1510, fechaActualizacion: '2026-09-14T18:58:00.000Z' },
];

const BLUELYTICS = {
  oficial: { value_avg: 1505.0, value_sell: 1531.0, value_buy: 1479.0 },
  blue: { value_avg: 1538.5, value_sell: 1555.0, value_buy: 1522.0 },
  oficial_euro: { value_avg: 1635.5, value_sell: 1664.0, value_buy: 1607.0 },
  last_update: '2026-09-14T16:16:03.25908-03:00',
};

test('dolarapi: toma oficial y blue, ignora las otras casas', () => {
  const r = interpretarDolarApi(DOLARAPI);
  assert.equal(r.estado, 'ok');
  assert.equal(r.oficial.compra, 1480);
  assert.equal(r.oficial.venta, 1530);
  assert.equal(r.oficial.promedio, 1505);      // calculado, dolarapi no lo trae
  assert.equal(r.blue.promedio, 1545);
  assert.equal(r.blue.fecha, '2026-09-14T18:58:00.000Z');
});

test('bluelytics: usa el promedio que ya viene, no lo recalcula', () => {
  const r = interpretarBluelytics(BLUELYTICS);
  assert.equal(r.oficial.promedio, 1505);
  assert.equal(r.blue.promedio, 1538.5);       // no 1538.5 por casualidad: viene dado
  assert.equal(r.blue.compra, 1522);
});

test('Argentina: respuestas rotas devuelven null en vez de medio dato', () => {
  assert.equal(interpretarDolarApi(null), null);
  assert.equal(interpretarDolarApi([]), null);
  assert.equal(interpretarDolarApi([{ casa: 'oficial', compra: 'nada', venta: null }]), null);
  assert.equal(interpretarBluelytics({}), null);
  assert.equal(interpretarBluelytics({ oficial: { value_avg: 3 } }), null); // fuera de rango
});

test('la brecha se calcula sobre los promedios', () => {
  assert.equal(calcularBrecha(1505, 1545), 2.7);
  assert.equal(calcularBrecha(1000, 2000), 100);
  assert.equal(calcularBrecha(0, 1545), null);
  assert.equal(calcularBrecha(null, 1545), null);
});
