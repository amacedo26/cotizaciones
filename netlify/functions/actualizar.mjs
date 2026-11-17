// Consulta las fuentes y guarda la foto y la serie. Corre cada 10 minutos.
//
// Las tareas programadas solo corren en deploys publicados: en previews y
// ramas no se dispara.
import { reunirDatos, puntoDe, tieneAlgo, aplicarVariaciones, marcarEstancadas } from '../../lib/fuentes.mjs';
import { fusionarHistoricos, limpiarTramoFalso } from '../../lib/parseo.mjs';
import { SEMILLA } from '../../lib/semilla.mjs';
import { almacen, CLAVE_FOTO, CLAVE_SERIE, CLAVE_BITACORA } from '../../lib/almacen.mjs';

export default async (req) => {
  const arranque = Date.now();
  const store = almacen();
  let bitacora;

  try {
    const foto = await reunirDatos();
    const punto = puntoDe(foto);

    // La semilla se fusiona siempre, no solo cuando el almacén está vacío: la
    // fusión deduplica por marca de tiempo, así que es idempotente, y si el
    // almacén se pierde la serie histórica se repara sola en la corrida
    // siguiente en vez de arrancar de cero.
    const guardada = (await store.get(CLAVE_SERIE, { type: 'json' })) ?? [];
    const previa = fusionarHistoricos(SEMILLA, guardada);
    // Una corrida donde no respondió nadie no merece un punto: dejaría un hueco
    // de nulls en el medio de la serie, que es peor que no tener el punto.
    const crecida = tieneAlgo(punto)
      ? fusionarHistoricos(previa, [punto])
      : previa;

    // Borra el tramo que dejó el espejo muerto. Va acá y no en un script aparte
    // porque la serie vive en el almacén y ésta es la única corrida que lo
    // escribe. Es idempotente: la primera pasada anula los 8.171 puntos y las
    // siguientes no encuentran nada. Se puede sacar cuando ya no toque nada.
    const { serie, tocados } = limpiarTramoFalso(crecida);
    if (tocados) console.log(`! reparación: ${tocados} puntos del BROU anulados`);

    // contra el punto de hace 24 horas, buscado por serie sobre el histórico
    aplicarVariaciones(foto, punto, previa);

    // Después de armar el punto, no antes: la lectura se guarda igual. Si la
    // fuente se detuvo, la línea plana en el histórico es justamente la prueba;
    // lo que cambia es que la tarjeta deja de presentarla como dato del día.
    marcarEstancadas(foto, serie);

    await store.setJSON(CLAVE_SERIE, serie);
    await store.setJSON(CLAVE_FOTO, { ...foto, puntos: serie.length });

    bitacora = {
      cuando: new Date().toISOString(),
      ok: true,
      duracionMs: Date.now() - arranque,
      ...(tocados ? { reparados: tocados } : {}),
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
