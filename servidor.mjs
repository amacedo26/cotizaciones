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
import { execFile } from 'node:child_process';
import { dirname, join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(fileURLToPath(import.meta.url));
const PUERTO = Number(process.env.PUERTO || 8787);
const CADA = 30 * 60 * 1000;

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

// --- bajar datos -------------------------------------------------------------
// Un fallo acá no se puede quedar callado: el tablero seguiría mostrando datos
// viejos con cara de frescos. Queda en el log y en la respuesta de /estado.
let ultimoPull = { cuando: null, ok: null, detalle: 'todavía no corrió' };

function bajarDatos() {
  execFile('git', ['pull', '--quiet'], { cwd: RAIZ, timeout: 60_000 }, (error, _salida, err) => {
    ultimoPull = error
      ? { cuando: new Date().toISOString(), ok: false, detalle: (err || error.message).trim().slice(0, 300) }
      : { cuando: new Date().toISOString(), ok: true, detalle: 'sin novedades o actualizado' };
    registrar(ultimoPull.ok ? 'datos al día' : `no se pudieron bajar datos: ${ultimoPull.detalle}`);
  });
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
    return respuesta.end(JSON.stringify({ puerto: PUERTO, carpeta: RAIZ, ultimoPull }, null, 2));
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
    const cache = /datos\.(js|json)$/.test(ruta) ? 'no-store' : 'no-cache';
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
  bajarDatos();
  setInterval(bajarDatos, CADA);
});
