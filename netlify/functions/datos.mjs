// Lo que lee el tablero: la última foto más la serie.
import { almacen, CLAVE_FOTO, CLAVE_SERIE } from '../../lib/almacen.mjs';
import { SEMILLA } from '../../lib/semilla.mjs';

export default async () => {
  const store = almacen();
  const [foto, serie] = await Promise.all([
    store.get(CLAVE_FOTO, { type: 'json' }),
    store.get(CLAVE_SERIE, { type: 'json' }),
  ]);

  if (!foto) {
    // Todavía no corrió ninguna actualización. Se responde 200 con lo que hay
    // para que la página muestre "sin datos todavía" en vez de un error.
    return Response.json({ actualizado: null, historico: SEMILLA, incidencias: [] });
  }

  return Response.json({ ...foto, historico: serie ?? SEMILLA }, {
    headers: { 'Cache-Control': 'public, max-age=60' },
  });
};

export const config = { path: '/api/datos' };
