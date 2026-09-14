# Tablero de cotizaciones

Oro, plata, dólar internacional y dólar uruguayo en una página. Abrir
`index.html` con doble clic alcanza.

## Para verlo

Tres formas, de más a menos automática.

**Como favorito del navegador (recomendado).** Doble clic en
`Instalar servicio.command`. Instala un servicio de macOS que arranca solo al
prender la Mac, sirve el tablero en `http://127.0.0.1:8787` y baja datos
frescos cada media hora. Esa dirección se agrega a favoritos y funciona
siempre. Para sacarlo: `Desinstalar servicio.command`.

El servidor escucha únicamente en `127.0.0.1`: nada fuera de esta máquina lo
alcanza. `http://127.0.0.1:8787/estado` dice si la última bajada de datos
funcionó, y `servidor.log` guarda el registro.

**De a una vez.** Doble clic en `Cotizaciones.command`: baja los últimos datos
y abre el tablero, sin instalar nada.

**Sin nada.** Abrir `index.html` directamente. Funciona, pero muestra los datos
que tengas bajados de la última vez.

## Cómo funciona

Hay dos motores, y conviene saber cuál da qué.

**El servidor local es el que da frescura.** Corre en la Mac, consulta las
fuentes cada 10 minutos y escribe archivos `*.local.*` que no están
versionados. La página los prefiere cuando son más nuevos.

**GitHub Actions es el respaldo.** Corre cada hora y commitea al repositorio,
para que la serie siga creciendo aunque la Mac esté apagada. Sus tareas
programadas son mejor esfuerzo: se retrasan y se saltean corridas, así que no
se le confía el dato del momento.

```
Servidor local (cada 10 min)          GitHub Actions (cada hora)
  └─ actualizar.mjs SALIDA_LOCAL=1      └─ actualizar.mjs
       escribe *.local.* (sin versionar)     escribe datos.js / historico.json
                                             y commitea
                    ↓                                   ↓
              la página toma el más reciente de los dos

fuentes
  ├─ api.gold-api.com          → oro (XAU) y plata (XAG), precio vivo
  ├─ forex-data-feed.swissquote.com → EUR/USD, USD/JPY, GBP/USD, USD/CAD,
  │                              USD/SEK, USD/CHF — vivos; de ahí sale el DXY
  ├─ api.frankfurter.dev       → respaldo de divisas (BCE, una vez por día hábil)
  └─ cotizaciones.bcu.gub.uy   → dólar uruguayo (SOAP)
```

Un HTML no puede consultar estas fuentes por su cuenta: el navegador bloquea
por CORS cualquier pedido a otro dominio. Todo tablero "en vivo" hecho con un
solo archivo HTML choca contra esto.

Una consulta local que falla **no escribe nada**: si escribiera un snapshot
vacío, al ser el más reciente la página lo preferiría y taparía datos buenos
con "sin dato".

## Por qué estas fuentes y no otras

No es una preferencia: son las únicas que respondieron desde un runner de
GitHub Actions. Verificado con `scripts/sondeo.mjs` el 2026-09-14:

| Fuente | Resultado | Veredicto |
|---|---|---|
| api.gold-api.com | 200, precio al segundo | ✅ en uso |
| forex-data-feed.swissquote.com | 200, bid/ask vivos en los 6 pares | ✅ en uso |
| api.frankfurter.dev | 200, pero una tasa por día hábil | ✅ solo de respaldo |
| cotizaciones.bcu.gub.uy | 200, SOAP | ✅ en uso |
| Yahoo Finance (query1 y query2) | 429 Too Many Requests | ❌ bloquea IPs de datacenter |
| Stooq (.com y .pl) | 404 en todos los símbolos | ❌ bloquea IPs de datacenter |
| goldprice.org | 403 Forbidden | ❌ |
| BEVSA | página de login | ❌ ver abajo |

Si alguna deja de responder, correr el sondeo de nuevo antes de cambiar código:
desde Actions, workflow "Cotizaciones", campo modo = `sondeo`.

## Sobre BEVSA

`dolaronline.bevsa.com.uy/Dolar/DataDolarNuevo` **no es público**. Devuelve la
página de login, y con cookie de sesión anónima responde `302` a la home. La
cuenta además tiene segundo factor y el sitio está detrás de Cloudflare, así
que un job desatendido no puede autenticarse. Insistir con reintentos solo
arriesga que marquen la cuenta.

Queda como extra manual: si se carga una cookie de sesión válida en el secreto
`BEVSA_COOKIE` del repositorio, el script la usa hasta que expire y el tablero
muestra la cotización interbancaria además de la del BCU. Sin ese secreto el
módulo no hace nada y todo funciona igual.

**El BCU no es BEVSA**: publica la cotización oficial, no la interbancaria. Los
valores difieren.

## Qué está calculado y qué viene de una fuente

Dos números del tablero no los publica nadie, los calcula el script, y están
etiquetados como tales:

- **DXY**: media geométrica ponderada frente a seis monedas, con la fórmula
  oficial del índice. Da diferencias del orden del 0,1 % contra el valor
  publicado. Hay una prueba que lo verifica contra un cálculo a mano.
- **Oro en pesos**: el oro en dólares multiplicado por el dólar uruguayo de la
  misma corrida. No es una cotización de mercado.

La **variación porcentual** de cada tarjeta se calcula contra la corrida
anterior propia, no contra el cierre del día: ninguna de estas fuentes
gratuitas publica el valor previo.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | El tablero. Sin dependencias ni CDN. |
| `datos.js` | Snapshot + histórico como variable global. Es lo que lee la página. |
| `datos.json` | Lo mismo, en JSON, por si otro proceso lo quiere. |
| `historico.json` | Serie acumulada de todas las corridas. |
| `raw-bevsa.json` | Última respuesta cruda de BEVSA, si el módulo opcional corrió. |
| `scripts/actualizar.mjs` | Consulta las fuentes y escribe los archivos. |
| `scripts/parseo.mjs` | Interpretación de números, del SOAP del BCU y cálculo del DXY. |
| `scripts/probar-parseo.mjs` | Pruebas, sin red. |
| `scripts/sondeo.mjs` | Diagnóstico: qué fuentes responden desde dónde. |
| `servidor.mjs` | Servidor local. Consulta las fuentes cada 10 min y baja del repo cada 30. |
| `*.local.*` | Datos que escribe el servidor local. No versionados; la página los prefiere si son más nuevos. |
| `Instalar servicio.command` | Deja el tablero siempre disponible en 127.0.0.1:8787. |
| `Desinstalar servicio.command` | Saca el servicio. No borra archivos. |

## Correr a mano

```bash
node scripts/actualizar.mjs --dry   # consulta e imprime, no escribe nada
node scripts/actualizar.mjs         # consulta y escribe los archivos
node --test scripts/probar-parseo.mjs
node scripts/sondeo.mjs             # diagnóstico de fuentes
```

Requiere Node 20 o superior (usa `fetch` nativo). Sin `npm install`.

## Límites conocidos

- **Con el servidor local instalado, los datos se refrescan cada 10 minutos.**
  Sin él, dependés del cron de Actions, que es impuntual por diseño.
- **El BCU publica por día hábil**, así que el dólar uruguayo no se mueve
  durante el día por más que todo lo demás sí. Se pide una ventana de diez días
  para que un feriado no deje la consulta vacía.
- **Si Swissquote se cae**, las divisas caen al respaldo del BCE y vuelven a
  moverse una vez por día. El tablero lo dice en la fuente de cada tarjeta.
- **El oro no cotiza 24/7.** Cierra el viernes por la tarde de Nueva York y
  abre el domingo. El fin de semana el valor se repite.
- **Los cron de GitHub Actions no son puntuales** y se deshabilitan solos si el
  repo pasa 60 días sin actividad. Si el tablero deja de actualizarse sin
  motivo, revisar eso primero.
- Las fuentes son gratuitas y sin contrato: pueden cortar sin aviso. Para
  decisiones con plata de verdad, verificar contra la fuente oficial.
