#!/usr/bin/env node
// Servidor local del tablero. Sin dependencias.
//
// Sirve esta carpeta en http://127.0.0.1:8787 y cada media hora baja los datos
// que dejó el robot. Escucha solo en 127.0.0.1: nada fuera de esta máquina
// puede alcanzarlo.
//
// Normalmente lo arranca el servicio de macOS ("Instalar servicio.command").
// Para correrlo a mano: node servidor.mjs

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fusionarHistoricos } from './scripts/parseo.mjs';

const correr = promisify(execFile);

const RAIZ = dirname(fileURLToPath(import.meta.url));
const PUERTO = Number(process.env.PUERTO || 8787);
const CADA_DATOS = 10 * 60 * 1000;  // consultar las fuentes: esto da la frescura
const CADA_PULL = 30 * 60 * 1000;   // bajar del repo: código y serie larga
const CADA_PUBLICAR = 30 * 60 * 1000; // subir la serie propia al repo

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const momento = () => new Date().toLocaleString('es-UY', { timeZone: 'America/Montevideo' });
const registrar = (msg) => console.log(`[${momento()}] ${msg}`);

// --- consultar las fuentes ---------------------------------------------------
// Acá está la frescura del tablero. Las tareas programadas de GitHub Actions
// son mejor esfuerzo y se saltean corridas, así que no se les confía el dato
// del momento: esta máquina consulta las fuentes por su cuenta y escribe
// archivos .local, que no están versionados y nunca chocan con el repositorio.
let ultimaConsulta = { cuando: null, ok: null, detalle: 'todavía no corrió' };

function consultarFuentes() {
  execFile(process.execPath, [join(RAIZ, 'scripts', 'actualizar.mjs')],
    { cwd: RAIZ, timeout: 120_000, env: { ...process.env, SALIDA_LOCAL: '1' } },
    (error, salida, err) => {
      const ultimaLinea = (texto) => (texto || '').trim().split('\n').pop() || '';
      // el detalle útil suele estar en stdout aunque el proceso termine en error
      ultimaConsulta = error
        ? { cuando: new Date().toISOString(), ok: false,
            detalle: (ultimaLinea(err) || ultimaLinea(salida) || error.message).slice(0, 300) }
        : { cuando: new Date().toISOString(), ok: true, detalle: ultimaLinea(salida) };
      registrar(ultimaConsulta.ok ? `datos frescos — ${ultimaConsulta.detalle}` : `falló la consulta: ${ultimaConsulta.detalle}`);
    });
}

// --- bajar del repositorio ---------------------------------------------------
// Un fallo acá no se puede quedar callado: el tablero seguiría mostrando datos
// viejos con cara de frescos. Queda en el log y en la respuesta de /estado.
let ultimoPull = { cuando: null, ok: null, detalle: 'todavía no corrió' };

function bajarDatos() {
  if (publicando) return; // la publicación ya hace su propio pull
  execFile('git', ['pull', '--quiet'], { cwd: RAIZ, timeout: 60_000 }, (error, _salida, err) => {
    ultimoPull = error
      ? { cuando: new Date().toISOString(), ok: false, detalle: (err || error.message).trim().slice(0, 300) }
      : { cuando: new Date().toISOString(), ok: true, detalle: 'sin novedades o actualizado' };
    registrar(ultimoPull.ok ? 'datos al día' : `no se pudieron bajar datos: ${ultimoPull.detalle}`);
  });
}

// --- publicar la serie propia ------------------------------------------------
// Las tareas programadas de GitHub Actions saltean corridas, así que el
// histórico del repositorio queda con huecos. Esta máquina mide cada 10 minutos
// y publica su serie, que es más densa: el repositorio termina completo para
// todas las horas en que la Mac estuvo encendida.
//
// Solo se toca historico.json. datos.js sigue siendo la foto del robot, y la
// página prefiere la local igual, así que no hay motivo para pisarla desde acá.
let ultimaPublicacion = { cuando: null, ok: null, detalle: 'todavía no corrió' };
// Mientras se publica hay un instante con historico.json escrito y sin
// commitear: un git pull ahí fallaría por cambios locales. Se turnan.
let publicando = false;

function leerSerie(ruta) {
  if (!existsSync(ruta)) return [];
  try {
    const d = JSON.parse(readFileSync(ruta, 'utf8'));
    return Array.isArray(d) ? d : [];
  } catch { return []; }
}

async function publicarSerie() {
  if (publicando) return;
  publicando = true;
  const marcar = (ok, detalle) => {
    ultimaPublicacion = { cuando: new Date().toISOString(), ok, detalle: String(detalle).slice(0, 300) };
    registrar(ok ? `serie publicada — ${detalle}` : `no se pudo publicar la serie: ${detalle}`);
  };

  try {
    // el repositorio puede haber avanzado; los archivos versionados están
    // limpios porque lo local vive en *.local.*, así que el rebase no choca
    await correr('git', ['pull', '--rebase', '--quiet'], { cwd: RAIZ, timeout: 60_000 });

    const delRepo = leerSerie(join(RAIZ, 'historico.json'));
    const propia = leerSerie(join(RAIZ, 'historico.local.json'));
    if (!propia.length) return marcar(true, 'todavía no hay serie propia');

    const fusionada = fusionarHistoricos(delRepo, propia);
    if (fusionada.length === delRepo.length) return marcar(true, 'el repositorio ya está al día');

    const nuevos = fusionada.length - delRepo.length;
    writeFileSync(join(RAIZ, 'historico.json'), JSON.stringify(fusionada));
    await correr('git', ['add', 'historico.json'], { cwd: RAIZ, timeout: 30_000 });
    await correr('git', ['commit', '-m', `serie local: +${nuevos} punto${nuevos === 1 ? '' : 's'}`],
      { cwd: RAIZ, timeout: 30_000 });
    await correr('git', ['push', '--quiet'], { cwd: RAIZ, timeout: 60_000 });
    marcar(true, `+${nuevos} punto${nuevos === 1 ? '' : 's'} al repositorio`);
  } catch (e) {
    // dejar el archivo como estaba: un push a medias no debe ensuciar el clone
    try { await correr('git', ['checkout', '--', 'historico.json'], { cwd: RAIZ, timeout: 30_000 }); } catch { /* nada */ }
    marcar(false, (e.stderr || e.message || 'error desconocido').trim());
  } finally {
    publicando = false;
  }
}

// --- servidor ----------------------------------------------------------------
async function resolver(url) {
  const pedido = decodeURIComponent(new URL(url, 'http://127.0.0.1').pathname);
  const relativo = normalize(pedido === '/' ? '/index.html' : pedido).replace(/^(\.\.[/\\])+/, '');
  const ruta = join(RAIZ, relativo);
  // no se sirve nada fuera de esta carpeta, pase lo que pase con la ruta pedida
  if (!ruta.startsWith(RAIZ)) return null;
  try {
    const info = await stat(ruta);
    return info.isFile() ? ruta : null;
  } catch { return null; }
}

const servidor = createServer(async (pedido, respuesta) => {
  if (pedido.url === '/estado') {
    respuesta.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return respuesta.end(JSON.stringify({ puerto: PUERTO, carpeta: RAIZ, ultimaConsulta, ultimoPull, ultimaPublicacion }, null, 2));
  }

  const ruta = await resolver(pedido.url);
  if (!ruta) {
    respuesta.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return respuesta.end('No existe.');
  }

  try {
    const contenido = await readFile(ruta);
    const tipo = TIPOS[extname(ruta).toLowerCase()] || 'application/octet-stream';
    // los datos nunca se cachean: si no, el refresco del tablero sirve de poco
    const cache = /datos(\.local)?\.(js|json)$/.test(ruta) ? 'no-store' : 'no-cache';
    respuesta.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': cache });
    respuesta.end(contenido);
  } catch (e) {
    respuesta.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    respuesta.end('Error leyendo el archivo.');
  }
});

servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    registrar(`el puerto ${PUERTO} ya está ocupado. ¿Hay otra copia corriendo?`);
    process.exit(1);
  }
  registrar(`error del servidor: ${e.message}`);
  process.exit(1);
});

servidor.listen(PUERTO, '127.0.0.1', () => {
  registrar(`tablero en http://127.0.0.1:${PUERTO} — sirviendo ${RAIZ}`);
  consultarFuentes();
  bajarDatos();
  setInterval(consultarFuentes, CADA_DATOS);
  setInterval(bajarDatos, CADA_PULL);
  // la primera publicación espera: antes tiene que existir una serie propia
  setTimeout(() => { publicarSerie(); setInterval(publicarSerie, CADA_PUBLICAR); }, 2 * 60 * 1000);
});
