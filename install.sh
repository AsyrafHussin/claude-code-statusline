#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.claude/statusline-command.sh"
SETTINGS="$HOME/.claude/settings.json"

echo "Installing Claude Code status line..."

# Check dependencies
if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required but not installed."
  echo "  Install: brew install jq (macOS) or apt install jq (Linux)"
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "Error: git is required but not installed."
  exit 1
fi

# Create .claude directory if needed
mkdir -p "$HOME/.claude"

# Backup existing script if present
if [ -f "$DEST" ]; then
  cp "$DEST" "${DEST}.bak"
  echo "  Backed up existing script to ${DEST}.bak"
fi

# Copy script
cp "$SCRIPT_DIR/statusline.sh" "$DEST"
chmod +x "$DEST"
echo "  Copied statusline.sh -> $DEST"

# Configure settings.json
if [ -f "$SETTINGS" ]; then
  if jq -e '.statusLine' "$SETTINGS" >/dev/null 2>&1; then
    echo "  statusLine already configured in $SETTINGS"
  else
    tmp=$(mktemp)
    jq --arg cmd "bash \"$DEST\"" '. + {"statusLine": {"type": "command", "command": $cmd}}' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
    echo "  Added statusLine config to $SETTINGS"
  fi
else
  jq -n --arg cmd "bash \"$DEST\"" '{"statusLine": {"type": "command", "command": $cmd}}' > "$SETTINGS"
  echo "  Created $SETTINGS with statusLine config"
fi

echo ""
echo "Done! Restart Claude Code to see your new status line."
