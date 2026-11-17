// Funciones puras del tablero: interpretar números, aplanar respuestas y podar
// el histórico. Separadas del script principal para poder probarlas sin red.

// Rango plausible del dólar interbancario uruguayo. Sirve para detectar que el
// parser agarró el campo equivocado (un volumen, un id) en vez de una cotización.
export const UYU_MIN = 20;
export const UYU_MAX = 200;

// Las unidades de cuenta se piden al mismo servicio que el dólar, así que
// necesitan su propia banda: la del dólar rechazaría a las dos.
// Referencias de setiembre de 2026: UI ≈ 6,63 y UR ≈ 1.923.
export const UI_MIN = 1;
export const UI_MAX = 1_000;
export const UR_MIN = 100;
export const UR_MAX = 1_000_000;

// Acepta 41.25, "41,25", "1.234,56", "USD 1.234,56".
export function aNumero(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim().replace(/[^\d,.-]/g, '');
  if (!limpio || /^[.,-]+$/.test(limpio)) return null;
  let normalizado;
  if (limpio.includes(',') && limpio.includes('.')) {
    // el separador decimal es el último que aparece
    normalizado = limpio.lastIndexOf(',') > limpio.lastIndexOf('.')
      ? limpio.replace(/\./g, '').replace(',', '.')
      : limpio.replace(/,/g, '');
  } else if (limpio.includes(',')) {
    normalizado = limpio.replace(',', '.');
  } else {
    normalizado = limpio;
  }
  const n = Number.parseFloat(normalizado);
  return Number.isFinite(n) ? n : null;
}

export function aplanar(valor, prefijo = '', salida = {}) {
  if (valor === null || valor === undefined) return salida;
  if (Array.isArray(valor)) {
    valor.forEach((v, i) => aplanar(v, `${prefijo}[${i}]`, salida));
  } else if (typeof valor === 'object') {
    for (const [k, v] of Object.entries(valor)) aplanar(v, prefijo ? `${prefijo}.${k}` : k, salida);
  } else {
    salida[prefijo] = valor;
  }
  return salida;
}

const PATRONES = {
  compra:   /compra|comprador|bid/i,
  venta:    /venta(?!na)|vendedor|ask|oferta/i,
  promedio: /promedio|prom(?![a-z])|average|mid(?![a-z])/i,
  ultimo:   /ultim|last|cierre|close|cotiza|precio|valor|tc(?![a-z])/i,
};

// La estructura del endpoint de BEVSA no está documentada y puede cambiar sin
// aviso, así que en vez de asumir nombres de campos se aplana la respuesta y se
// busca el primer campo cuyo nombre y cuyo valor sean compatibles con una
// cotización en pesos. Si nada encaja, se devuelve estado 'revisar' con todos
// los campos, para ajustar PATRONES contra la respuesta real.
export function interpretarBevsa(payload) {
  const campos = aplanar(payload);
  const elegido = {};

  for (const [nombre, patron] of Object.entries(PATRONES)) {
    for (const [clave, valor] of Object.entries(campos)) {
      if (!patron.test(clave)) continue;
      const n = aNumero(valor);
      if (n === null || n < UYU_MIN || n > UYU_MAX) continue; // descarta ids, volúmenes, flags
      elegido[nombre] = { valor: n, campo: clave };
      break;
    }
  }

  const fechaClave = Object.keys(campos).find(
    (k) => /fecha|hora|date|time/i.test(k) && String(campos[k]).length > 3,
  );

  const compra = elegido.compra?.valor ?? null;
  const venta = elegido.venta?.valor ?? null;
  const promedio = elegido.promedio?.valor
    ?? (compra !== null && venta !== null ? +((compra + venta) / 2).toFixed(4) : elegido.ultimo?.valor ?? null);

  if (promedio === null) {
    return {
      estado: 'revisar',
      compra: null, venta: null, promedio: null,
      campos,
      error: 'ningún campo parece una cotización en pesos',
    };
  }

  return {
    estado: 'ok',
    compra,
    venta,
    promedio,
    fecha: fechaClave ? String(campos[fechaClave]) : null,
    origenCampos: Object.fromEntries(Object.entries(elegido).map(([k, v]) => [k, v.campo])),
    campos,
  };
}

// Resolución completa los últimos 90 días; más atrás, un punto por día.
export function podar(serie, ahora = Date.now()) {
  const corte = ahora - 90 * 24 * 3600 * 1000;
  const recientes = serie.filter((p) => Date.parse(p.t) >= corte);
  const porDia = new Map();
  for (const p of serie.filter((p) => Date.parse(p.t) < corte)) porDia.set(p.t.slice(0, 10), p);
  return [...porDia.values(), ...recientes].sort((a, b) => a.t.localeCompare(b.t));
}

// --- BCU --------------------------------------------------------------------
// El servicio devuelve SOAP y responde con TODO el rango de fechas pedido, del
// más viejo al más nuevo, así que hay que quedarse con el último registro. Se
// parsea con expresiones regulares a propósito: traer un parser de XML entero
// para leer cuatro campos de una estructura estable no se justifica.
// La banda es un parámetro porque el mismo servicio sirve el dólar (≈40), la
// UI (≈6,6) y la UR (≈1.900): un solo rango plausible no puede cubrirlas.
export function interpretarBcu(xml, banda = { min: UYU_MIN, max: UYU_MAX }) {
  if (typeof xml !== 'string' || !xml.includes('datoscotizaciones')) {
    const fallo = /<mensaje>([^<]+)<\/mensaje>/.exec(xml || '');
    return { estado: 'error', error: fallo ? fallo[1] : 'respuesta sin cotizaciones' };
  }

  const estado = /<status>(\d+)<\/status>/.exec(xml);
  if (estado && estado[1] !== '1') {
    const mensaje = /<mensaje>([^<]*)<\/mensaje>/.exec(xml);
    return { estado: 'error', error: `el BCU devolvió status ${estado[1]}: ${mensaje?.[1] || 'sin mensaje'}` };
  }

  const campo = (bloque, nombre) => {
    const m = new RegExp(`<${nombre}>([^<]*)</${nombre}>`).exec(bloque);
    return m ? m[1].trim() : null;
  };

  const registros = [...xml.matchAll(/<datoscotizaciones\.dato[^>]*>([\s\S]*?)<\/datoscotizaciones\.dato>/g)]
    .map((m) => ({
      fecha: campo(m[1], 'Fecha'),
      nombre: campo(m[1], 'Nombre'),
      compra: aNumero(campo(m[1], 'TCC')),
      venta: aNumero(campo(m[1], 'TCV')),
    }))
    .filter((r) => r.fecha && (r.compra !== null || r.venta !== null));

  if (!registros.length) return { estado: 'error', error: 'ningún registro con cotización' };

  // el más reciente por fecha, sin confiar en el orden de la respuesta
  const ultimo = registros.reduce((a, b) => (a.fecha.localeCompare(b.fecha) >= 0 ? a : b));
  const promedio = ultimo.compra !== null && ultimo.venta !== null
    ? +((ultimo.compra + ultimo.venta) / 2).toFixed(4)
    : (ultimo.compra ?? ultimo.venta);

  if (promedio < banda.min || promedio > banda.max) {
    return { estado: 'revisar', error: `valor fuera de rango plausible: ${promedio}`, ...ultimo };
  }
  return { estado: 'ok', ...ultimo, promedio, registros: registros.length };
}

// El índice dólar no lo publica ninguna fuente gratuita, pero su fórmula es
// pública: media geométrica ponderada frente a seis monedas. Da diferencias del
// orden del 0,1 % contra el valor oficial, suficiente para seguir la tendencia.
// Los exponentes oficiales son negativos para EUR y GBP porque el índice usa
// EUR/USD y GBP/USD, que se cotizan al revés que el resto. Acá las tasas llegan
// todas como "moneda por dólar" (ya invertidas), así que los seis exponentes
// quedan positivos. Verificado: con las tasas del 2026-09-11 da 99,17.
const CANASTA = [
  ['EUR', 0.576],
  ['JPY', 0.136],
  ['GBP', 0.119],
  ['CAD', 0.091],
  ['SEK', 0.042],
  ['CHF', 0.036],
];

export function calcularDxy(tasas) {
  let producto = 50.14348112;
  for (const [moneda, exponente] of CANASTA) {
    const tasa = aNumero(tasas?.[moneda]);
    if (tasa === null || tasa <= 0) return null;
    producto *= Math.pow(tasa, exponente);
  }
  return +producto.toFixed(3);
}

// --- Swissquote --------------------------------------------------------------
// Devuelve varios perfiles de precio (tiers comerciales) cuyo medio es casi
// idéntico. Se toma el de spread más ajustado, que es la mejor cotización
// disponible y además hace la elección determinista.
export function interpretarSwissquote(payload) {
  const perfiles = payload?.[0]?.spreadProfilePrices;
  if (!Array.isArray(perfiles) || !perfiles.length) return null;

  let mejor = null;
  for (const p of perfiles) {
    const bid = aNumero(p?.bid);
    const ask = aNumero(p?.ask);
    if (bid === null || ask === null || bid <= 0 || ask <= 0) continue;
    const spread = Math.abs(ask - bid);
    if (!mejor || spread < mejor.spread) mejor = { spread, medio: (bid + ask) / 2 };
  }
  return mejor ? +mejor.medio.toFixed(6) : null;
}

// --- Argentina ---------------------------------------------------------------
// El peso argentino se mueve en órdenes de magnitud a lo largo de los años, así
// que el rango plausible es ancho a propósito: sirve para descartar un id o un
// porcentaje colado, no para validar el valor.
export const ARS_MIN = 50;
export const ARS_MAX = 500_000;

function cotizacionArs(compra, venta, promedio, fecha) {
  const c = aNumero(compra);
  const v = aNumero(venta);
  const p = aNumero(promedio) ?? (c !== null && v !== null ? (c + v) / 2 : (v ?? c));
  if (p === null || p < ARS_MIN || p > ARS_MAX) return null;
  return { compra: c, venta: v, promedio: +p.toFixed(2), fecha: fecha ?? null };
}

// dolarapi.com devuelve un arreglo con una entrada por "casa" de cambio.
export function interpretarDolarApi(payload) {
  if (!Array.isArray(payload)) return null;
  const porCasa = (casa) => payload.find((x) => x?.casa === casa);
  const leer = (x) => (x ? cotizacionArs(x.compra, x.venta, null, x.fechaActualizacion) : null);
  const oficial = leer(porCasa('oficial'));
  const blue = leer(porCasa('blue'));
  if (!oficial && !blue) return null;
  return { estado: 'ok', oficial, blue };
}

// bluelytics usa otra forma: un objeto por tipo, con el promedio ya calculado.
export function interpretarBluelytics(payload) {
  const leer = (x) => (x ? cotizacionArs(x.value_buy, x.value_sell, x.value_avg, payload?.last_update) : null);
  const oficial = leer(payload?.oficial);
  const blue = leer(payload?.blue);
  if (!oficial && !blue) return null;
  return { estado: 'ok', oficial, blue };
}

// La brecha entre el oficial y el informal: el número que se mira de verdad.
// La pizarra del BROU, leída del sitio del banco.
//
// En setiembre de 2026 esto no se podía: el portal armaba la tabla en el
// navegador y el HTML que llegaba por fetch no tenía ni un número. El banco
// rehízo el sitio y ahora la sirve armada, así que se lee directo y se deja de
// depender de un espejo. El espejo que se usaba, uy.dolarapi, se congeló el
// 2026-09-21 y estuvo casi dos meses sirviendo la misma foto como si fuera de
// hoy; de ahí que esta función devuelva también la fecha que imprime la página,
// que es lo único que permite notar que el sitio dejó de actualizarse.
//
// La fila que interesa es la que dice sólo "Dólar". "Dólar eBROU" es otra
// cotización, preferencial, y no es la de la pizarra.
const sinAcentos = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Hace cuántos días que una serie no cambia de valor. Es la única forma de
// notar que una fuente murió cuando la fuente no dice cuándo se actualizó: el
// espejo del BROU estuvo 57 días devolviendo el mismo número con cara de dato
// fresco, y ninguna cabecera ni ningún campo de la respuesta lo delataba.
export function diasSinMoverse(serie, clave, ahora = Date.now()) {
  let ultimoCambio = null, anterior = null;
  for (const p of serie || []) {
    const v = p?.[clave];
    if (typeof v !== 'number' || !isFinite(v)) continue;
    const t = Date.parse(p.t);
    if (!isFinite(t)) continue;
    if (anterior === null || v !== anterior) { ultimoCambio = t; anterior = v; }
  }
  if (ultimoCambio === null) return null;
  return Math.floor((ahora - ultimoCambio) / 86400_000);
}

// Días enteros entre una fecha AAAA-MM-DD y ahora. Sirve para notar que una
// fuente dejó de moverse, que es una falla que no se ve mirando el número.
export function diasDeDiferencia(fecha, ahora = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return null;
  const dia = Date.parse(fecha + 'T00:00:00Z');
  const hoy = Date.parse(ahora.toISOString().slice(0, 10) + 'T00:00:00Z');
  if (!isFinite(dia) || !isFinite(hoy)) return null;
  return Math.round((hoy - dia) / 86400_000);
}

export function interpretarPizarraBrou(html) {
  if (typeof html !== 'string' || !html.includes('cotizacion-portlet')) {
    return { estado: 'error', error: 'la página no trae la tabla de cotizaciones' };
  }

  let fila = null;
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const moneda = /<p class="moneda">([\s\S]*?)<\/p>/.exec(m[1]);
    if (!moneda) continue;                       // el encabezado no tiene moneda
    if (sinAcentos(moneda[1]) !== 'dolar') continue;  // "dolar ebrou" no es ésta
    fila = m[1];
    break;
  }
  if (!fila) return { estado: 'error', error: 'no está la fila del dólar' };

  // En la fila van, en orden: compra, venta, arbitraje compra, arbitraje venta.
  // Las celdas separadoras usan class="valor1" y quedan afuera por el atributo.
  const valores = [...fila.matchAll(/<p class="valor">([\s\S]*?)<\/p>/g)]
    .map((m) => aNumero(m[1].trim()))
    .filter((v) => v !== null);
  const [compra, venta] = valores;
  if (compra === undefined || venta === undefined) {
    return { estado: 'error', error: 'la fila del dólar vino sin las dos puntas' };
  }

  const promedio = +((compra + venta) / 2).toFixed(4);
  if (compra < UYU_MIN || compra > UYU_MAX || venta < UYU_MIN || venta > UYU_MAX) {
    return { estado: 'revisar', error: `valores fuera de rango plausible: ${compra} / ${venta}`, compra, venta };
  }
  return { estado: 'ok', compra, venta, promedio };
}

export function calcularBrecha(oficial, blue) {
  const o = aNumero(oficial);
  const b = aNumero(blue);
  if (o === null || b === null || o <= 0) return null;
  return +(((b / o) - 1) * 100).toFixed(1);
}

// --- fusión de históricos ----------------------------------------------------
// Une dos series de mediciones por marca de tiempo. Hoy se usa en cada corrida
// para fusionar la semilla con lo guardado y agregar el punto nuevo; como
// deduplica, repetirlo no cuesta nada y la serie se repara sola si el almacén
// se pierde.
//
// Ante dos puntos del mismo instante gana el que tiene más campos con dato: una
// corrida donde media fuente falló no debe pisar a una completa. Esa regla viene
// de cuando medían dos procesos en paralelo, pero sigue haciendo falta, porque
// una corrida parcial y una completa pueden caer en el mismo segundo.
function completitud(punto) {
  return Object.keys(punto).filter((k) => k !== 't' && punto[k] !== null && punto[k] !== undefined).length;
}

export function fusionarHistoricos(a, b, ahora = Date.now()) {
  const porFecha = new Map();
  for (const punto of [...(a || []), ...(b || [])]) {
    if (!punto || typeof punto.t !== 'string') continue;
    const previo = porFecha.get(punto.t);
    if (!previo || completitud(punto) > completitud(previo)) porFecha.set(punto.t, punto);
  }
  return podar([...porFecha.values()], ahora);
}

// --- contraste entre agregadores argentinos ----------------------------------
// El blue no tiene fuente oficial: cada agregador releva el mercado informal por
// su cuenta y los valores nunca coinciden exacto. Un umbral demasiado fino haría
// saltar el aviso todos los días, y un aviso que salta siempre no se mira.
//
// Los umbrales salen de lo observado el 2026-09-14 en una consulta normal:
// el oficial coincidía exacto entre ambas fuentes y el blue difería 0,42 %.
export const UMBRAL_OFICIAL = 0.5;  // es un precio publicado: deberían coincidir
export const UMBRAL_BLUE = 1.5;     // es un relevamiento: el ruido es esperable

function diferenciaPorcentual(a, b) {
  const x = aNumero(a);
  const y = aNumero(b);
  if (x === null || y === null || y === 0) return null;
  return +Math.abs(((x - y) / y) * 100).toFixed(2);
}

export function contrastarArgentina(principal, secundaria) {
  if (!secundaria) return { estado: 'sin contraste' };

  const difOficial = diferenciaPorcentual(principal?.oficial?.promedio, secundaria.oficial?.promedio);
  const difBlue = diferenciaPorcentual(principal?.blue?.promedio, secundaria.blue?.promedio);

  const discrepaOficial = difOficial !== null && difOficial > UMBRAL_OFICIAL;
  const discrepaBlue = difBlue !== null && difBlue > UMBRAL_BLUE;

  return {
    estado: 'ok',
    oficial: secundaria.oficial?.promedio ?? null,
    blue: secundaria.blue?.promedio ?? null,
    difOficial,
    difBlue,
    discrepaOficial,
    discrepaBlue,
    discrepa: discrepaOficial || discrepaBlue,
  };
}

// --- recorte y reducción de la serie -----------------------------------------
// Un gráfico de mil y pico de píxeles de ancho no puede dibujar más de un punto
// por píxel: mandar la serie entera es tirar datos que nadie ve, y con 144
// puntos por día el peso crece sin techo.
export const RANGOS_MS = {
  '24h': 24 * 3600 * 1000,
  '7d': 7 * 24 * 3600 * 1000,
  '30d': 30 * 24 * 3600 * 1000,
  todo: null,
};

export function recortar(serie, rango, ahora = Date.now()) {
  const ms = RANGOS_MS[rango];
  if (!ms) return serie || [];
  const desde = ahora - ms;
  return (serie || []).filter((p) => Date.parse(p.t) >= desde);
}

// Se conserva el ÚLTIMO punto de cada tramo, nunca un promedio: promediar
// inventaría valores que nunca se midieron, y en precios eso no se hace. Los
// extremos de la serie se preservan siempre, para que el gráfico empiece y
// termine donde de verdad empieza y termina.
export function reducir(serie, maximo = 1000) {
  const n = (serie || []).length;
  if (n <= maximo) return serie || [];

  const porTramo = n / maximo;
  const salida = [];
  for (let i = 0; i < maximo; i++) {
    const fin = Math.min(n - 1, Math.floor((i + 1) * porTramo) - 1);
    const punto = serie[Math.max(fin, Math.floor(i * porTramo))];
    if (punto && salida[salida.length - 1] !== punto) salida.push(punto);
  }
  if (salida[0] !== serie[0]) salida.unshift(serie[0]);
  if (salida[salida.length - 1] !== serie[n - 1]) salida.push(serie[n - 1]);
  return salida;
}

// --- referencia para la variación --------------------------------------------
// Comparar contra la medición anterior (diez minutos atrás) sirve para el oro,
// que se mueve todo el tiempo, pero no para el dólar del Banco Central: cambia
// una vez por día, así que 143 de cada 144 corridas darían 0 % y el tablero
// diría "no se movió" el día entero justo cuando sí se movió.
//
// La referencia se busca POR SERIE, no una sola para todas: brl y los valores
// argentinos empezaron a medirse después que el resto, y una referencia común
// los compararía contra un momento en el que no existían.
export function puntoDeReferencia(serie, clave, objetivo) {
  let anterior = null;  // el más reciente que esté en el objetivo o antes
  let masViejo = null;  // el primero con valor, por si toda la serie es posterior

  for (const p of serie || []) {
    const v = p?.[clave];
    if (typeof v !== 'number' || !isFinite(v)) continue;
    const t = Date.parse(p.t);
    if (!isFinite(t)) continue;
    if (masViejo === null) masViejo = p;
    if (t <= objetivo) anterior = p;
  }

  const elegido = anterior ?? masViejo;
  if (!elegido) return null;
  return { punto: elegido, completa: anterior !== null };
}
