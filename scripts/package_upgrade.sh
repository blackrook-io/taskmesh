#!/bin/bash
# Upgrade the API from Express 4 to Express 5.3 (T0289).
set -euo pipefail

cd "$(dirname "$0")/.."

npm install express@5.3.0
npm install --save-dev @types/express@5.0.6
npm test
npm run lint
npm run build:all
