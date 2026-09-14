// Acceso al almacén de datos. En producción el almacén es global y persiste
// entre deploys; en previews y ramas se usa uno atado al deploy, para que las
// pruebas no ensucien la serie real.
import { getStore, getDeployStore } from '@netlify/blobs';

export const CLAVE_FOTO = 'foto';
export const CLAVE_SERIE = 'serie';
export const CLAVE_BITACORA = 'bitacora';

export function almacen() {
  // consistencia fuerte: la serie se lee, se modifica y se vuelve a escribir,
  // y con lecturas eventuales una corrida podría pisar a la anterior
  const opciones = { name: 'cotizaciones', consistency: 'strong' };
  const contexto = globalThis.Netlify?.context?.deploy?.context;
  return contexto === 'production' ? getStore(opciones) : getDeployStore(opciones);
}
