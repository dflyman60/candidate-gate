#!/usr/bin/env sh
cd "$(dirname "$0")/.." || exit 1
PORT="${1:-8765}"
echo "Candidate Gate → http://localhost:${PORT}/"
exec python3 -m http.server "$PORT"
