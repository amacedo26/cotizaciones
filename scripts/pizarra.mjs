#!/usr/bin/env node
// Dos preguntas sobre la pizarra del BROU, una exploratoria y una medida:
//
//   1. ¿Hay alguna fuente mejor que el espejo de dolarapi? Sobre todo: ¿alguna
//      que diga cuándo movió el banco, y no cuándo la miró el espejo?
//   2. ¿Cada cuánto cambia de verdad el sello de dolarapi? Con dos muestras
//      parecía horario, pero dos muestras no son una cadencia.
//
//   node scripts/pizarra.mjs            → solo la parte 1
//   MINUTOS=70 node scripts/pizarra.mjs → además mide 70 minutos, cada 2
//
// Nunca falla: es exploratorio.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function traer(url, opciones = {}) {
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: { 'User-Agent': UA, ...(opciones.headers || {}) },
      ...opciones,
    });
    return { ok: r.ok, estado: r.status, tipo: (r.headers.get('content-type') || '?').split(';')[0], cuerpo: await r.text() };
  } catch (e) {
    return { ok: false, estado: 0, tipo: 'excepción', cuerpo: e.message };
  }
}

async function probar(etiqueta, url, largo = 260, opciones) {
  const r = await traer(url, opciones);
  console.log(`\n[${etiqueta}] ${r.estado} ${r.tipo}`);
  console.log('  ' + r.cuerpo.replace(/\s+/g, ' ').slice(0, largo));
  return r;
}

console.log('=== 1. ¿De dónde saca el portal del BROU sus números? ===');
// Si la tabla la arma el navegador, el número tiene que venir de algún pedido
// que hace la página. Ese pedido es el que interesa: sería la fuente directa.
const portal = await traer('https://www.brou.com.uy/cotizaciones');
console.log(`\n[portal] ${r_(portal)} — ${portal.cuerpo.length} bytes`);
function r_(x) { return `${x.estado} ${x.tipo}`; }

if (portal.cuerpo) {
  const html = portal.cuerpo;
  const unicos = (lista) => [...new Set(lista)];

  const scripts = unicos([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]))
    .filter((u) => !/jquery|polyfill|analytics|gtm|gtag|recaptcha/i.test(u));
  console.log(`\n  scripts propios (${scripts.length}):`);
  scripts.slice(0, 25).forEach((u) => console.log('    ' + u));

  const pistas = unicos([...html.matchAll(/[^"'\s(]*(?:\/api\/|\.json|render_portlet|p_p_resource_id|invoke|cotizacion)[^"'\s)]*/gi)].map((m) => m[0]))
    .filter((u) => u.length > 8 && u.length < 220);
  console.log(`\n  cadenas que huelen a endpoint (${pistas.length}):`);
  pistas.slice(0, 30).forEach((u) => console.log('    ' + u));

  console.log('\n  ¿usa Liferay.Service / AUI io?', /Liferay\.Service|AUI\(\)\.use|\.io\.request/.test(html));
  console.log('  ¿hay un portlet de cotizaciones?', /cotizacion/i.test(html));
}

// Si algún script propio trae la URL adentro, aparece acá.
console.log('\n--- adentro de los scripts propios ---');
const html0 = portal.cuerpo || '';
const propios = [...new Set([...html0.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]))]
  .filter((u) => /brou/i.test(u) && /\.js/i.test(u)).slice(0, 6);
for (const ruta of propios) {
  const url = ruta.startsWith('http') ? ruta : 'https://www.brou.com.uy' + ruta;
  const js = await traer(url);
  if (!js.ok) { console.log(`  [${ruta}] ${r_(js)}`); continue; }
  const urls = [...new Set([...js.cuerpo.matchAll(/["'`](\/[^"'`\s]*(?:cotiza|api|json)[^"'`\s]*)["'`]/gi)].map((m) => m[1]))];
  console.log(`  [${ruta}] ${js.cuerpo.length} bytes · candidatos: ${urls.slice(0, 10).join(' , ') || 'ninguno'}`);
}

console.log('\n\n=== 2. Otros espejos y APIs de cotizaciones uruguayas ===');
await probar('dolarapi uy (raíz)', 'https://uy.dolarapi.com/', 200);
await probar('dolarapi docs', 'https://docs.dolarapi.com/', 200);
await probar('dolarapi uy /v1/cotizaciones/usd', 'https://uy.dolarapi.com/v1/cotizaciones/usd', 200);
await probar('cotizaciones.com.uy', 'https://cotizaciones.com.uy/', 160);
await probar('cambio.uy', 'https://cambio.uy/', 160);
await probar('dolar.uy', 'https://dolar.uy/', 160);
await probar('preciodolar (uy)', 'https://api.preciodolar.com/uy', 160);
await probar('ebrou', 'https://www.ebrou.com.uy/', 160);
// El BCU publica su propia pizarra de bancos: si existe, es oficial y fechada.
await probar('BCU arbitrajes/pizarra', 'https://www.bcu.gub.uy/Estadisticas-e-Indicadores/Paginas/Cotizaciones.aspx', 200);

console.log('\n\n=== 3. ¿Cada cuánto cambia el sello de dolarapi? ===');
const minutos = Number(process.env.MINUTOS || 0);
if (!minutos) {
  console.log('  (MINUTOS no está puesto: no se mide. Correr con MINUTOS=70 para medirlo.)');
} else {
  const cada = 2 * 60_000;
  const hasta = Date.now() + minutos * 60_000;
  let selloPrevio = null, valorPrevio = null;
  console.log(`  midiendo ${minutos} minutos, una lectura cada 2\n`);
  console.log('  lectura (UTC)     compra / venta    fechaActualizacion        ¿cambió?');
  while (Date.now() < hasta) {
    const r = await traer('https://uy.dolarapi.com/v1/cotizaciones', { headers: { Accept: 'application/json' } });
    const ahora = new Date().toISOString().slice(11, 19);
    let linea;
    try {
      const usd = JSON.parse(r.cuerpo).find((f) => f.moneda === 'USD');
      const valor = `${usd.compra} / ${usd.venta}`;
      const sello = usd.fechaActualizacion;
      const cambios = [];
      if (selloPrevio !== null && sello !== selloPrevio) cambios.push('SELLO');
      if (valorPrevio !== null && valor !== valorPrevio) cambios.push('VALOR');
      linea = `  ${ahora}   ${valor.padEnd(16)}  ${sello}  ${cambios.join(' + ') || '—'}`;
      selloPrevio = sello; valorPrevio = valor;
    } catch (e) {
      linea = `  ${ahora}   ERROR ${r.estado} ${String(r.cuerpo).slice(0, 60)}`;
    }
    console.log(linea);
    if (Date.now() + cada < hasta) await new Promise((r) => setTimeout(r, cada));
    else break;
  }
  console.log('\n  Leer la columna "¿cambió?": si SELLO aparece siempre al mismo minuto');
  console.log('  de cada hora, el espejo se refresca por reloj. Si VALOR nunca aparece,');
  console.log('  es que el banco no movió la pizarra en la ventana medida.');
}

console.log('\nListo.');
