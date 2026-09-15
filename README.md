# Tablero de cotizaciones

Oro, plata, dólar internacional y dólar regional (Uruguay, Brasil, Argentina)
en una página que se actualiza sola cada 10 minutos. Vive en Netlify.

## Cómo funciona

Una sola pieza, sin nada corriendo en ninguna computadora personal:

```
Netlify — función programada, cada 10 minutos
  └─ lib/fuentes.mjs  consulta todas las fuentes en paralelo
       ├─ api.gold-api.com               oro (XAU) y plata (XAG), precio vivo
       ├─ forex-data-feed.swissquote.com EUR/USD, USD/JPY, GBP/USD, USD/CAD,
       │                                 USD/SEK, USD/CHF — vivos; de ahí el DXY
       ├─ api.fxratesapi.com             dólar en Brasil, por minuto
       ├─ dolarapi.com                   dólar en Argentina, oficial y blue
       └─ cotizaciones.bcu.gub.uy        dólar en Uruguay (SOAP)
  └─ guarda la foto y la serie en Netlify Blobs

public/index.html  →  pide /api/datos  →  lee de Blobs
```

El tablero es público: cualquiera con la URL lo ve. Son cotizaciones de
mercado, información pública.

**Este repositorio también es público, y por una razón concreta.** El plan
Free de Netlify solo construye repos privados cuando quien empuja es un
miembro verificado de la cuenta; cualquier otro push queda bloqueado con
"Unrecognized Git contributor" y el sitio se congela en la última versión que
sí construyó. Hacerlo público levanta esa restricción. No hay nada sensible
acá: todas las fuentes son abiertas y no hay ninguna clave ni token. Si algún
día hace falta guardar un secreto, va como variable de entorno en Netlify,
nunca en el repositorio.

## Rutas

| Ruta | Qué devuelve |
|---|---|
| `/` | El tablero |
| `/api/datos?rango=24h` | La última foto más el tramo de serie pedido. Rangos: `24h` (por defecto), `7d`, `30d`, `todo` |
| `/api/serie` | La serie completa, sin recortar ni reducir |
| `/api/estado` | Diagnóstico: cómo salió la última corrida y hace cuánto |

**Si el tablero parece congelado, mirar `/api/estado` primero.** Dice si la
última corrida salió bien, cuándo fue, cuánto tardó y qué incidencias hubo.
El campo `alDia` es `false` si pasaron más de 25 minutos sin una corrida.

## Por qué estas fuentes y no otras

No es preferencia: son las únicas que respondieron desde una IP de datacenter,
que es desde donde corre la función. Verificado con `scripts/sondeo.mjs`:

| Fuente | Resultado | Veredicto |
|---|---|---|
| api.gold-api.com | 200, precio al segundo | ✅ en uso |
| forex-data-feed.swissquote.com | 200, bid/ask vivos en los 6 pares | ✅ en uso |
| api.fxratesapi.com | 200, cotización por minuto | ✅ en uso |
| dolarapi.com | 200, oficial y blue | ✅ en uso |
| cotizaciones.bcu.gub.uy | 200, SOAP | ✅ en uso |
| api.frankfurter.dev | 200, pero una tasa por día hábil | ✅ solo de respaldo |
| api.bluelytics.com.ar | 200 | ✅ solo de respaldo |
| Yahoo Finance | 429 en query1 y query2 | ❌ bloquea datacenters |
| Stooq | 404 en todos los símbolos, en .com y .pl | ❌ bloquea datacenters |
| goldprice.org | 403 | ❌ |
| Swissquote USD/BRL y USD/ARS | devuelve `[]` | ❌ no los lista |
| awesomeapi | 429, cuota agotada | ❌ desde IPs compartidas |
| BEVSA | página de login | ❌ ver abajo |

Si alguna deja de responder: `npm run sondeo` desde cualquier máquina.
Para explorar fuentes nuevas sin tocar el diagnóstico: `npm run candidatos`.

## Sobre BEVSA

`dolaronline.bevsa.com.uy/Dolar/DataDolarNuevo` **no es público**. Devuelve la
página de login, y con cookie anónima responde `302`. La cuenta tiene segundo
factor y el sitio está detrás de Cloudflare: un proceso desatendido no puede
autenticarse, e insistir solo arriesga que marquen la cuenta.

**El BCU no es BEVSA**: publica la cotización oficial, no la interbancaria.

## Por qué /api/datos no devuelve la serie entera

La serie crece 144 puntos por día y la página la vuelve a pedir cada dos minutos.
Devolverla completa haría que el peso creciera sin techo, para dibujar puntos que
no entran en la pantalla: un gráfico de mil y pico de píxeles no puede mostrar
más de un punto por píxel.

Así que se recorta al período pedido y se reduce a **1.000 puntos como máximo**.
Medido con una serie de 90 días (12.960 puntos):

| pedido | peso | puntos |
|---|---|---|
| `/api/datos` (24 h, el que usa la página al abrir) | 27 KB | 144 |
| `/api/datos?rango=todo` | 176 KB | 1.000 |
| `/api/serie` | 2.253 KB | 12.960 |

Lo que importa no es el número sino que **está acotado**: a los dos años de
histórico, `?rango=todo` va a seguir pesando lo mismo.

Al reducir se conserva el **último punto de cada tramo, nunca un promedio**:
promediar inventaría valores que nunca se midieron, y en precios eso no se hace.
Los extremos de la serie se preservan siempre. Cuando la respuesta viene
reducida el tablero lo dice al pie del gráfico, porque un gráfico que no avisa
que muestra una muestra miente por omisión.

## El gráfico

Línea con ejes rotulados, grilla, etiqueta en el último valor, cruz de lectura al
pasar el mouse y una tabla con los valores. La tabla no es un extra: ningún valor
puede quedar accesible solo por hover.

Los controles de serie y período van **arriba** del gráfico, no adentro de su
tarjeta: eligen qué se mira. El período por defecto es 24 horas porque a 144
puntos por día la serie entera se vuelve ilegible en cualquier ancho de pantalla.

Los decimales del eje salen del paso entre marcas, no de la serie: con un paso de
0,05 el tercer decimal sería siempre cero y además invitaría a leer «cuarenta mil»
donde dice cuarenta.

Cada serie tiene su color, pero **se muestra una sola a la vez** y el botón activo
lleva el nombre escrito, así que la identidad nunca depende del color. Por eso la
paleta no necesita separación para daltonismo entre colores adyacentes: nunca hay
dos líneas juntas. Lo que sí se corrigió es que la plata era gris — en un gráfico
el gris es el color de lo secundario, no el de un dato.

## Qué está calculado y qué viene de una fuente

Tres números del tablero no los publica nadie; los calcula el código, y están
etiquetados como tales en pantalla:

- **DXY**: media geométrica ponderada frente a seis monedas, con la fórmula
  oficial. Difiere del valor publicado en el orden del 0,1 %. Hay una prueba
  que lo verifica contra un cálculo a mano.
- **Brecha cambiaria**: el blue sobre el oficial argentino.
- **Oro en pesos**: el oro en dólares por el dólar uruguayo de la misma corrida.
  No es una cotización de mercado.

La **variación** de cada tarjeta se calcula contra la corrida anterior propia:
ninguna de estas fuentes gratuitas publica el valor previo. El encabezado dice
contra qué momento se está comparando, porque tras un corte la comparación
puede ser contra algo viejo y un salto grande parecería un error de datos.

## El dólar blue

No tiene fuente oficial. Sale de agregadores que relevan el mercado informal y
**el valor difiere entre uno y otro**: en la misma consulta, dolarapi daba
compra 1535 donde bluelytics daba 1522. Por eso el tablero lo marca como
informal y muestra de qué agregador salió.

Por lo mismo se consultan **las dos** fuentes en cada corrida, no una como
respaldo de la otra: bluelytics sirve de contraste. Si los valores se separan
más de lo razonable, el tablero lo avisa en pantalla y queda registrado en las
incidencias. Los umbrales son distintos según el tipo, y salen de lo observado
el 2026-09-14 en una consulta normal:

| | umbral | por qué |
|---|---|---|
| Oficial | 0,5 % | es un precio publicado: las fuentes deberían coincidir, y coincidían exacto |
| Blue | 1,5 % | es un relevamiento del mercado informal: difería 0,42 % sin que pasara nada raro |

Un umbral más fino haría saltar el aviso todos los días, y un aviso que aparece
siempre deja de mirarse.

**El oficial argentino no se mueve durante el día y eso no es una falla.** No es
un precio de mercado continuo: se fija un par de veces por jornada y después
queda quieto. El blue sí sigue al mercado informal durante la tarde. Por eso
cada tarjeta muestra la hora que declara la fuente, no la de la corrida: si
dice la una de la tarde, es que la fuente no tiene nada más nuevo.

## Desarrollo

```bash
npm install
npm test                      # 24 pruebas, sin red
npm run sondeo                # ¿responden las fuentes en producción?
npm run candidatos            # explorar fuentes nuevas
node scripts/ver-foto.mjs     # la foto completa, sin escribir nada
netlify dev                   # el sitio entero, local
```

Requiere Node 20 o superior.

## Límites conocidos

- **Las funciones programadas solo corren en deploys publicados.** En previews
  y ramas no se disparan.
- **30 segundos de techo** por corrida. Por eso las fuentes se consultan en
  paralelo; en serie no había margen.
- **Los blobs no tienen control de concurrencia**: última escritura gana. Con
  una sola función cada 10 minutos no es un problema, pero conviene saberlo
  antes de agregar otra que escriba.
- **El oro no cotiza los fines de semana.** Cierra el viernes por la tarde de
  Nueva York y abre el domingo; fuera de rueda el valor se repite.
- **El BCU publica por día hábil**, así que el dólar uruguayo no se mueve
  durante el día. Se pide una ventana de diez días para que un feriado no deje
  la consulta vacía.
- **Las fuentes son gratuitas y sin contrato**: pueden cortar sin aviso. Para
  decisiones con plata de verdad, verificar contra la fuente oficial.

## Historia del proyecto

Antes de Netlify esto corría con GitHub Actions y un servidor local en una Mac.
Se abandonaron los dos: las tareas programadas de Actions saltean corridas sin
aviso (el 2026-09-14 se perdieron las de 16:00 y 18:00 UTC), y el servidor
local solo cubre las horas en que la máquina está encendida.

Si quedó instalado el servicio de macOS de esa época, sacarlo con
`Desinstalar servicio.command`. Ya no hace falta y seguiría empujando commits.
