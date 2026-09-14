#!/bin/bash
# Doble clic para que el tablero quede siempre disponible en el navegador.
# Instala un servicio de macOS que arranca solo al prender la Mac, sirve el
# tablero en http://127.0.0.1:8787 y baja datos frescos cada media hora.
# Para sacarlo: "Desinstalar servicio.command".

set -u
cd "$(dirname "$0")" || exit 1
CARPETA="$(pwd -P)"
ETIQUETA="uy.amr.cotizaciones"
PLIST="$HOME/Library/LaunchAgents/$ETIQUETA.plist"
PUERTO=8787
URL="http://127.0.0.1:$PUERTO"

echo "Instalando el servicio del tablero…"
echo "  carpeta: $CARPETA"
echo

# --- node ---
# El servicio arranca con un PATH mínimo, así que la ruta de node va escrita.
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "✗ No encuentro Node en esta Mac."
  echo "  Instalalo desde https://nodejs.org (versión 20 o superior) y volvé a correr esto."
  read -r -p "Enter para cerrar."
  exit 1
fi
echo "✓ Node: $NODE ($("$NODE" --version))"

# --- datos ---
# Si el pull no anda sin contraseña, el servicio serviría datos viejos en
# silencio. Mejor enterarse ahora que dentro de un mes.
if git -C "$CARPETA" pull --quiet 2>/tmp/cotizaciones-pull.err; then
  echo "✓ Bajar datos funciona sin pedir contraseña."
else
  echo "⚠ No se pudieron bajar datos:"
  sed 's/^/    /' /tmp/cotizaciones-pull.err
  echo "  El servicio va a andar igual, pero mostrando los datos que ya tenés."
  echo "  Para arreglarlo, hacé un 'git pull' a mano acá y guardá las credenciales."
fi
rm -f /tmp/cotizaciones-pull.err
echo

# --- servicio ---
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$ETIQUETA</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$CARPETA/servidor.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$CARPETA</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$CARPETA/servidor.log</string>
  <key>StandardErrorPath</key><string>$CARPETA/servidor.log</string>
</dict>
</plist>
PLISTEOF

# se descarga primero por si ya estaba instalado, para que tome los cambios
launchctl bootout "gui/$(id -u)/$ETIQUETA" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST"

# --- esperar a que levante ---
echo "Esperando a que arranque…"
for _ in $(seq 1 20); do
  if curl -s -o /dev/null --max-time 2 "$URL"; then
    echo
    echo "✓ Listo. El tablero vive en:"
    echo
    echo "    $URL"
    echo
    echo "  Agregalo a favoritos. Arranca solo cada vez que prendas la Mac."
    echo "  Diagnóstico: $URL/estado    Registro: servidor.log"
    open "$URL"
    read -r -p "Enter para cerrar."
    exit 0
  fi
  sleep 1
done

echo
echo "✗ El servicio no respondió en 20 segundos. Mirá servidor.log:"
tail -n 15 "$CARPETA/servidor.log" 2>/dev/null | sed 's/^/    /'
read -r -p "Enter para cerrar."
exit 1
