#!/bin/bash
# Doble clic para ver el tablero de cotizaciones.
# Baja los últimos datos que dejó el robot y abre la página en el navegador.
cd "$(dirname "$0")"

echo "Bajando los últimos datos…"
if git pull --quiet 2>/dev/null; then
  echo "Datos actualizados."
else
  echo "No se pudo actualizar (¿sin internet?). Se abre lo último que haya guardado."
fi

open index.html
