#!/bin/bash
set -euo pipefail
export HOME=/home/bonasoadmin
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use 24.13.0 >/dev/null
cd /home/bonasoadmin/BONASOV1/frontend
export PORT="${PORT:-13000}"
exec npm run start
