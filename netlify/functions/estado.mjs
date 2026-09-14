// Diagnóstico: cómo salió la última corrida programada y hace cuánto fue.
// Es lo primero que hay que mirar cuando el tablero parece congelado.
import { almacen, CLAVE_BITACORA, CLAVE_SERIE } from './almacen.mjs';

export default async () => {
  const store = almacen();
  const [bitacora, serie] = await Promise.all([
    store.get(CLAVE_BITACORA, { type: 'json' }),
    store.get(CLAVE_SERIE, { type: 'json' }),
  ]);

  const minutos = bitacora?.cuando
    ? Math.round((Date.now() - Date.parse(bitacora.cuando)) / 60000)
    : null;

  return Response.json({
    ultimaCorrida: bitacora ?? 'todavía no corrió ninguna',
    haceMinutos: minutos,
    // corre cada 10 minutos: más de 25 sin corridas es una señal, no un retraso
    alDia: minutos !== null && minutos <= 25,
    puntosEnLaSerie: Array.isArray(serie) ? serie.length : 0,
  });
};

export const config = { path: '/api/estado' };
