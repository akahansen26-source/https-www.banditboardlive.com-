#!/bin/sh
set -e
cd "$(dirname "$0")"
npx esbuild src/plugin.ts --bundle --platform=node --format=esm --target=node20 \
  --banner:js="import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" \
  --outfile=com.banditboardlive.scoreboard.sdPlugin/bin/plugin.js
