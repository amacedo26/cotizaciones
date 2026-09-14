// Funciones puras del tablero: interpretar números, aplanar respuestas y podar
// el histórico. Separadas del script principal para poder probarlas sin red.

// Rango plausible del dólar interbancario uruguayo. Sirve para detectar que el
// parser agarró el campo equivocado (un volumen, un id) en vez de una cotización.
export const UYU_MIN = 20;
export const UYU_MAX = 200;

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
export function interpretarBcu(xml) {
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

  if (promedio < UYU_MIN || promedio > UYU_MAX) {
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
