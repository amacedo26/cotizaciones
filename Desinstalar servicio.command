#!/bin/bash
# Doble clic para sacar el servicio local que usaba este tablero antes de
# mudarse a Netlify. Ya no hace falta: el tablero vive en
# https://cotizaciones-amr.netlify.app y se actualiza solo cada 10 minutos.
#
# Importante sacarlo: ese servicio tenía permiso para empujar commits a este
# repositorio, y tras la mudanza el archivo que ejecutaba ya no existe.

set -u
cd "$(dirname "$0")" || exit 1
ETIQUETA="uy.amr.cotizaciones"
PLIST="$HOME/Library/LaunchAgents/$ETIQUETA.plist"

launchctl bootout "gui/$(id -u)/$ETIQUETA" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null
rm -f "$PLIST"

echo "✓ Servicio desinstalado."
echo "  El tablero está en https://cotizaciones-amr.netlify.app"
echo "  Ya no hay nada corriendo en esta Mac."
read -r -p "Enter para cerrar."
