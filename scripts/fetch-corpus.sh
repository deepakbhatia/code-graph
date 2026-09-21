#!/bin/sh
set -e
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/corpus/ai-chatbot"
if [ -d "$DEST/.git" ]; then
  echo "corpus already present: $DEST"
  exit 0
fi
mkdir -p "$ROOT/corpus"
git clone --depth 1 https://github.com/vercel/ai-chatbot.git "$DEST"
