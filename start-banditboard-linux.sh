#!/bin/bash
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Installer Node.js LTS fra https://nodejs.org/ og prøv igen."; exit 1; }
[ -d node_modules/express ] || npm install --omit=dev --no-audit --no-fund
node server.js
