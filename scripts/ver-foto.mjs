#!/usr/bin/env node
// Consulta todas las fuentes y muestra la foto que guardaría la función
// programada, sin escribir nada. Para probar desde una máquina cualquiera.
//
//   node scripts/ver-foto.mjs
import { reunirDatos, puntoDe, tieneAlgo } from '../lib/fuentes.mjs';

const foto = await reunirDatos();
console.log(JSON.stringify({ foto, punto: puntoDe(foto) }, null, 2));
if (!tieneAlgo(puntoDe(foto))) {
  console.error('\nNinguna fuente respondió: esta corrida no agregaría un punto.');
  process.exit(2);
}
