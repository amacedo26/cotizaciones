# Tablero de cotizaciones

Oro, plata, dólar internacional y dólar uruguayo en una página. Abrir
`index.html` con doble clic alcanza.

## Para verlo

Doble clic en `Cotizaciones.command`: baja los últimos datos y abre el tablero
en el navegador. Si preferís a mano, abrir `index.html` directamente también
funciona, pero muestra los datos que tengas bajados.

## Cómo funciona

No hay servidor. La página **no consulta ninguna fuente**: lee `datos.js`, que
es un archivo que un job de GitHub Actions reescribe cada dos horas.

```
GitHub Actions (cron 0 */2 * * *)
  └─ scripts/actualizar.mjs
       ├─ api.gold-api.com      → oro (XAU) y plata (XAG)
       ├─ api.frankfurter.dev   → EUR, JPY, GBP, CAD, SEK, CHF (tasas del BCE)
       │                          de ahí salen EUR/USD, USD/JPY y el DXY calculado
       └─ cotizaciones.bcu.gub.uy → dólar uruguayo (SOAP)
     escribe datos.js, datos.json, historico.json
  └─ commitea los cambios al repo
```

Un HTML no puede consultar estas fuentes por su cuenta: el navegador bloquea
por CORS cualquier pedido a otro dominio. Todo tablero "en vivo" hecho con un
solo archivo HTML choca contra esto.

## Por qué estas fuentes y no otras

No es una preferencia: son las únicas que respondieron desde un runner de
GitHub Actions. Verificado con `scripts/sondeo.mjs` el 2026-09-14:

| Fuente | Resultado | Veredicto |
|---|---|---|
| api.gold-api.com | 200, precio al segundo | ✅ en uso |
| api.frankfurter.dev | 200, canasta completa | ✅ en uso |
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

## Correr a mano

```bash
node scripts/actualizar.mjs --dry   # consulta e imprime, no escribe nada
node scripts/actualizar.mjs         # consulta y escribe los archivos
node --test scripts/probar-parseo.mjs
node scripts/sondeo.mjs             # diagnóstico de fuentes
```

Requiere Node 20 o superior (usa `fetch` nativo). Sin `npm install`.

## Límites conocidos

- **Los datos no son en tiempo real.** Se refrescan cada dos horas. Oro y plata
  vienen al segundo; el resto no.
- **Las divisas se mueven una vez por día hábil**: el BCE publica una tasa
  diaria. Entre corridas del mismo día, EUR/USD y el DXY no cambian.
- **El BCU publica por día hábil**, así que el dólar uruguayo tampoco se mueve
  cada dos horas. Se pide una ventana de diez días para que un feriado no deje
  la consulta vacía.
- **El oro no cotiza 24/7.** Cierra el viernes por la tarde de Nueva York y
  abre el domingo. El fin de semana el valor se repite.
- **Los cron de GitHub Actions no son puntuales** y se deshabilitan solos si el
  repo pasa 60 días sin actividad. Si el tablero deja de actualizarse sin
  motivo, revisar eso primero.
- Las fuentes son gratuitas y sin contrato: pueden cortar sin aviso. Para
  decisiones con plata de verdad, verificar contra la fuente oficial.
