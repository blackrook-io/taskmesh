#!/bin/bash
# Upgrade packages together: Express 5.3 (T0289), TypeScript 7.0 (T0290), dotenv 18 (T0291), @types/node 22 (T0292).
set -euo pipefail

cd "$(dirname "$0")/.."

npm install express@5.3.0
npm install --save-dev @types/express@5.0.6
npm install --save-dev typescript@7.0.2
npm install dotenv@18.0.8
npm install --save-dev @types/node@22.20.5
npm install --prefix client --save-dev @types/node@22.20.5
npm test
npm run lint
npm run build:all
