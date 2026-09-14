#!/bin/bash
# Doble clic para sacar el servicio del tablero.
# No borra nada de la carpeta: solo deja de arrancar solo.

set -u
cd "$(dirname "$0")" || exit 1
ETIQUETA="uy.amr.cotizaciones"
PLIST="$HOME/Library/LaunchAgents/$ETIQUETA.plist"

launchctl bootout "gui/$(id -u)/$ETIQUETA" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null
rm -f "$PLIST"

echo "✓ Servicio desinstalado. El favorito a 127.0.0.1:8787 deja de funcionar."
echo "  Los archivos del tablero siguen acá; se puede abrir index.html con doble clic."
read -r -p "Enter para cerrar."
