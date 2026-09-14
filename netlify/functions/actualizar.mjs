// Consulta las fuentes y guarda la foto y la serie. Corre cada 10 minutos.
//
// Las tareas programadas solo corren en deploys publicados: en previews y
// ramas no se dispara.
import { reunirDatos, puntoDe, tieneAlgo } from '../../lib/fuentes.mjs';
import { fusionarHistoricos } from '../../lib/parseo.mjs';
import { SEMILLA } from '../../lib/semilla.mjs';
import { almacen, CLAVE_FOTO, CLAVE_SERIE, CLAVE_BITACORA } from '../../lib/almacen.mjs';

export default async (req) => {
  const arranque = Date.now();
  const store = almacen();
  let bitacora;

  try {
    const foto = await reunirDatos();
    const punto = puntoDe(foto);

    const previa = (await store.get(CLAVE_SERIE, { type: 'json' })) ?? SEMILLA;
    // Una corrida donde no respondió nadie no merece un punto: dejaría un hueco
    // de nulls en el medio de la serie, que es peor que no tener el punto.
    const serie = tieneAlgo(punto)
      ? fusionarHistoricos(previa, [punto])
      : previa;

    await store.setJSON(CLAVE_SERIE, serie);
    await store.setJSON(CLAVE_FOTO, { ...foto, puntos: serie.length });

    bitacora = {
      cuando: new Date().toISOString(),
      ok: true,
      duracionMs: Date.now() - arranque,
      puntos: serie.length,
      agregado: serie.length > previa.length,
      incidencias: foto.incidencias,
    };
  } catch (e) {
    bitacora = {
      cuando: new Date().toISOString(),
      ok: false,
      duracionMs: Date.now() - arranque,
      error: String(e?.message ?? e).slice(0, 400),
    };
  }

  // La bitácora se guarda pase lo que pase: un fallo silencioso es el peor
  // modo de falla para algo que corre solo cada diez minutos.
  try { await store.setJSON(CLAVE_BITACORA, bitacora); } catch { /* nada que hacer */ }
  console.log(JSON.stringify(bitacora));
};

export const config = {
  schedule: '*/10 * * * *',
};
