#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js er ikke installeret. Åbner download-siden – installer 'LTS' og start BanditBoard Live igen."
  open "https://nodejs.org/"
  read -p "Tryk Enter for at lukke..."
  exit 1
fi
if [ ! -d node_modules/express ]; then
  echo "Installerer BanditBoard Live – det tager et øjeblik..."
  npm install --omit=dev --no-audit --no-fund
fi
node server.js
