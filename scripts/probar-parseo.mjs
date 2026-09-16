#!/usr/bin/env node
// Prueba el parser contra formas plausibles de respuesta, sin tocar la red.
//   node scripts/probar-parseo.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aNumero, interpretarBevsa, interpretarBcu, interpretarSwissquote, interpretarDolarApi,
         interpretarBluelytics, calcularBrecha, calcularDxy, fusionarHistoricos, podar,
         contrastarArgentina, recortar, reducir, puntoDeReferencia } from '../lib/parseo.mjs';

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

test('fusionar: une las dos series sin duplicar ni perder puntos', () => {
  const ahora = Date.parse('2026-09-14T20:00:00Z');
  const repo = [
    { t: '2026-09-14T18:00:00.000Z', oro: 4290, bcu: 40.2 },
    { t: '2026-09-14T19:00:00.000Z', oro: 4293, bcu: 40.2 },
  ];
  const local = [
    { t: '2026-09-14T18:30:00.000Z', oro: 4291, bcu: 40.2 },
    { t: '2026-09-14T19:00:00.000Z', oro: 4293, bcu: 40.2 },  // mismo instante
    { t: '2026-09-14T19:40:00.000Z', oro: 4305, bcu: 40.2 },
  ];
  const r = fusionarHistoricos(repo, local, ahora);
  assert.equal(r.length, 4);
  assert.deepEqual(r.map((p) => p.t.slice(11, 16)), ['18:00', '18:30', '19:00', '19:40']);
});

test('fusionar: ante el mismo instante gana el punto más completo', () => {
  const ahora = Date.parse('2026-09-14T20:00:00Z');
  const flaco = [{ t: '2026-09-14T19:00:00.000Z', oro: 4293, bcu: null, brl: null }];
  const gordo = [{ t: '2026-09-14T19:00:00.000Z', oro: 4293, bcu: 40.2, brl: 5.14 }];
  assert.equal(fusionarHistoricos(flaco, gordo, ahora)[0].brl, 5.14);
  assert.equal(fusionarHistoricos(gordo, flaco, ahora)[0].brl, 5.14); // en cualquier orden
});

test('fusionar: tolera series vacías o con basura', () => {
  const ahora = Date.parse('2026-09-14T20:00:00Z');
  assert.deepEqual(fusionarHistoricos(null, null, ahora), []);
  assert.deepEqual(fusionarHistoricos([], [], ahora), []);
  assert.equal(fusionarHistoricos([{ sinFecha: 1 }, null], [{ t: '2026-09-14T19:00:00.000Z' }], ahora).length, 1);
});

test('contraste: los valores reales del 2026-09-14 no disparan el aviso', () => {
  // dolarapi daba oficial 1505 / blue 1545; bluelytics 1505 / 1538,5
  const r = contrastarArgentina(interpretarDolarApi(DOLARAPI), interpretarBluelytics(BLUELYTICS));
  assert.equal(r.estado, 'ok');
  assert.equal(r.difOficial, 0);
  assert.equal(r.difBlue, 0.42);      // el ruido normal entre relevamientos
  assert.equal(r.discrepa, false);
});

test('contraste: una diferencia grande en el oficial sí avisa', () => {
  const otra = JSON.parse(JSON.stringify(BLUELYTICS));
  otra.oficial.value_avg = 1580;      // 5 % arriba
  const r = contrastarArgentina(interpretarDolarApi(DOLARAPI), interpretarBluelytics(otra));
  assert.equal(r.discrepaOficial, true);
  assert.equal(r.discrepa, true);
  assert.equal(r.discrepaBlue, false);
});

test('contraste: el blue tolera más ruido antes de avisar', () => {
  const casi = JSON.parse(JSON.stringify(BLUELYTICS));
  casi.blue.value_avg = 1565;         // 1,3 % — por debajo del umbral
  assert.equal(contrastarArgentina(interpretarDolarApi(DOLARAPI), interpretarBluelytics(casi)).discrepaBlue, false);
  const lejos = JSON.parse(JSON.stringify(BLUELYTICS));
  lejos.blue.value_avg = 1480;        // 4,4 %
  assert.equal(contrastarArgentina(interpretarDolarApi(DOLARAPI), interpretarBluelytics(lejos)).discrepaBlue, true);
});

test('contraste: sin segunda fuente no inventa un veredicto', () => {
  const r = contrastarArgentina(interpretarDolarApi(DOLARAPI), null);
  assert.equal(r.estado, 'sin contraste');
  assert.equal(r.discrepa, undefined);
});

const serieLarga = Array.from({ length: 13000 }, (_, i) => ({
  t: new Date(Date.parse('2026-06-17T00:00:00.000Z') + i * 10 * 60 * 1000).toISOString(),
  oro: 4000 + i * 0.01,
}));

test('recortar: deja solo lo que cae dentro del período', () => {
  const ahora = Date.parse('2026-09-15T18:00:00.000Z');
  const serie = [
    { t: '2026-09-01T12:00:00.000Z' },   // hace 14 días
    { t: '2026-09-14T12:00:00.000Z' },   // hace 30 horas
    { t: '2026-09-15T12:00:00.000Z' },   // hace 6 horas
  ];
  assert.equal(recortar(serie, '24h', ahora).length, 1);
  assert.equal(recortar(serie, '7d', ahora).length, 2);
  assert.equal(recortar(serie, 'todo', ahora).length, 3);
});

test('reducir: respeta el tope y conserva los extremos', () => {
  const r = reducir(serieLarga, 1000);
  assert.ok(r.length <= 1002, `devolvió ${r.length}`);
  assert.equal(r[0].t, serieLarga[0].t);                          // el primero real
  assert.equal(r[r.length - 1].t, serieLarga[serieLarga.length - 1].t); // y el último
});

test('reducir: no toca una serie que ya entra en el tope', () => {
  const corta = serieLarga.slice(0, 500);
  assert.equal(reducir(corta, 1000), corta);
});

test('reducir: los puntos son medidos, nunca promediados', () => {
  const r = reducir(serieLarga, 100);
  const reales = new Set(serieLarga.map((p) => p.oro));
  for (const p of r) assert.ok(reales.has(p.oro), `${p.oro} no existe en la serie original`);
});

test('reducir: la serie devuelta mantiene el orden temporal', () => {
  const r = reducir(serieLarga, 300);
  for (let i = 1; i < r.length; i++) {
    assert.ok(Date.parse(r[i].t) > Date.parse(r[i - 1].t), `desorden en ${i}`);
  }
});

// Serie de dos días a diez minutos, con una clave que empieza tarde y un hueco.
const DOS_DIAS = Array.from({ length: 288 }, (_, i) => {
  const t = Date.parse('2026-09-14T18:00:00.000Z') + i * 10 * 60 * 1000;
  const p = { t: new Date(t).toISOString(), bcu: i < 200 ? 40.218 : 40.191 };
  if (i >= 200) p.brl = 5.15;        // empieza tarde, como pasó de verdad
  if (i === 150) p.bcu = null;       // la fuente no respondió esa vez
  return p;
});
const AHORA = Date.parse('2026-09-14T18:00:00.000Z') + 287 * 10 * 60 * 1000;
const HACE_24H = AHORA - 24 * 3600 * 1000;

test('referencia: toma el punto de hace 24 h, no el anterior', () => {
  const r = puntoDeReferencia(DOS_DIAS, 'bcu', HACE_24H);
  assert.equal(r.completa, true);
  assert.ok(Date.parse(r.punto.t) <= HACE_24H, 'la referencia no puede ser posterior al objetivo');
  assert.ok(AHORA - Date.parse(r.punto.t) <= 24 * 3600 * 1000 + 10 * 60 * 1000, 'ni mucho más vieja');
});

test('referencia: una serie más corta que 24 h usa su punto más viejo', () => {
  const corta = DOS_DIAS.slice(-30);   // cinco horas
  const r = puntoDeReferencia(corta, 'bcu', HACE_24H);
  assert.equal(r.completa, false);     // se declara que no llega a las 24 h
  assert.equal(r.punto.t, corta[0].t);
});

test('referencia: una clave que empieza tarde se compara con su propio inicio', () => {
  const r = puntoDeReferencia(DOS_DIAS, 'brl', HACE_24H);
  assert.equal(r.completa, false);
  assert.equal(r.punto.t, DOS_DIAS[200].t);  // el primero que tiene brl
});

test('referencia: se saltea el punto donde la fuente no respondió', () => {
  const objetivo = Date.parse(DOS_DIAS[150].t);
  const r = puntoDeReferencia(DOS_DIAS, 'bcu', objetivo);
  assert.notEqual(r.punto.t, DOS_DIAS[150].t);
  assert.equal(r.punto.t, DOS_DIAS[149].t);
});

test('referencia: el caso real — ayer un valor, hoy otro, y la variación aparece', () => {
  const r = puntoDeReferencia(DOS_DIAS, 'bcu', HACE_24H);
  const ahora = DOS_DIAS[DOS_DIAS.length - 1].bcu;
  assert.equal(r.punto.bcu, 40.218);   // lo que valía hace 24 h
  assert.equal(ahora, 40.191);         // lo que vale ahora
  const variacion = +(((ahora - r.punto.bcu) / r.punto.bcu) * 100).toFixed(2);
  assert.equal(variacion, -0.07);      // el número que el tablero mostraba como 0 %
});

test('referencia: sin ningún valor devuelve null en vez de inventar uno', () => {
  assert.equal(puntoDeReferencia([], 'bcu', HACE_24H), null);
  assert.equal(puntoDeReferencia(DOS_DIAS, 'noExiste', HACE_24H), null);
  assert.equal(puntoDeReferencia(null, 'bcu', HACE_24H), null);
});
