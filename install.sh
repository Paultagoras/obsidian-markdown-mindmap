#!/usr/bin/env bash
# Copy the plugin into an Obsidian vault.
#   ./install.sh "/c/Repos/Notes"
set -euo pipefail

VAULT="${1:-/c/Repos/Notes}"
DEST="$VAULT/.obsidian/plugins/mindmap-blocks"

if [ ! -d "$VAULT/.obsidian" ]; then
  echo "Not an Obsidian vault: $VAULT" >&2
  exit 1
fi

mkdir -p "$DEST"
cp manifest.json main.js styles.css "$DEST/"
echo "Installed to $DEST"
echo "Reload Obsidian (Ctrl+R), then enable 'Mindmap Blocks' in Community plugins."
