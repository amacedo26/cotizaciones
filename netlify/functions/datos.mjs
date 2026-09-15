// Lo que lee el tablero: la última foto más el tramo de serie que se pide.
//
// No devuelve la serie entera a propósito. Crece 144 puntos por día y la página
// la vuelve a pedir cada dos minutos; a los tres meses serían megabytes por
// pedido para dibujar puntos que no entran en la pantalla. La serie completa,
// sin recortar ni reducir, está en /api/serie.
import { almacen, CLAVE_FOTO, CLAVE_SERIE } from '../../lib/almacen.mjs';
import { recortar, reducir, RANGOS_MS } from '../../lib/parseo.mjs';
import { SEMILLA } from '../../lib/semilla.mjs';

const POR_DEFECTO = '24h';
const TOPE = 1000;

export default async (req) => {
  const pedido = new URL(req.url).searchParams.get('rango');
  const rango = Object.prototype.hasOwnProperty.call(RANGOS_MS, pedido) ? pedido : POR_DEFECTO;

  const store = almacen();
  const [foto, serie] = await Promise.all([
    store.get(CLAVE_FOTO, { type: 'json' }),
    store.get(CLAVE_SERIE, { type: 'json' }),
  ]);

  const completa = Array.isArray(serie) ? serie : SEMILLA;
  const enRango = recortar(completa, rango);
  const historico = reducir(enRango, TOPE);

  const cuerpo = {
    rango,
    puntos: { total: completa.length, enRango: enRango.length, devueltos: historico.length },
    // Se avisa cuando la serie viene reducida: un gráfico que oculta que está
    // mostrando una muestra miente por omisión.
    reducida: historico.length < enRango.length,
    historico,
  };

  if (!foto) {
    // Todavía no corrió ninguna actualización: se responde 200 para que la
    // página muestre "sin datos todavía" en vez de un error.
    return Response.json({ actualizado: null, incidencias: [], ...cuerpo });
  }

  return Response.json({ ...foto, ...cuerpo }, {
    headers: { 'Cache-Control': 'public, max-age=60' },
  });
};

export const config = { path: '/api/datos' };
