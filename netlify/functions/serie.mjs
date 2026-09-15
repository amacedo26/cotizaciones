// La serie completa, sin recortar ni reducir. Para bajarla o analizarla aparte;
// el tablero no la usa, justamente para no arrastrar su peso en cada pedido.
import { almacen, CLAVE_SERIE } from '../../lib/almacen.mjs';
import { SEMILLA } from '../../lib/semilla.mjs';

export default async () => {
  const serie = await almacen().get(CLAVE_SERIE, { type: 'json' });
  const historico = Array.isArray(serie) ? serie : SEMILLA;
  return Response.json({ puntos: historico.length, historico }, {
    headers: {
      'Cache-Control': 'public, max-age=300',
      'Content-Disposition': 'inline; filename="cotizaciones.json"',
    },
  });
};

export const config = { path: '/api/serie' };
