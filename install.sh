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

# Configure settings.json. It is written in place (cat >), not replaced (mv), so a settings.json that is
# a symlink into a dotfiles repo stays one, and keeps its permissions
WANT="bash \"$DEST\""
if [ -f "$SETTINGS" ]; then
  if ! jq empty "$SETTINGS" >/dev/null 2>&1; then
    echo "Error: $SETTINGS is not plain JSON (comments or a trailing comma?), so it was left as it is."
    printf '  Add this yourself:  "statusLine": { "type": "command", "command": %s }\n' "$(jq -n --arg c "$WANT" '$c')"
    exit 1
  fi
  current=$(jq -r '.statusLine.command // empty' "$SETTINGS")
  if [ "$current" = "$WANT" ]; then
    echo "  statusLine already set to this script"
  elif [ -n "$current" ]; then
    echo "  statusLine is already set to something else, left as it is:"
    echo "    $current"
    echo "  To use this one, set .statusLine.command in $SETTINGS to: $WANT"
  else
    tmp=$(mktemp)
    trap 'rm -f "$tmp"' EXIT
    jq --arg cmd "$WANT" '. + {"statusLine": {"type": "command", "command": $cmd}}' "$SETTINGS" > "$tmp"
    cat "$tmp" > "$SETTINGS"
    echo "  Added statusLine config to $SETTINGS"
  fi
else
  jq -n --arg cmd "$WANT" '{"statusLine": {"type": "command", "command": $cmd}}' > "$SETTINGS"
  echo "  Created $SETTINGS with statusLine config"
fi

echo ""
echo "Done! Restart Claude Code to see your new status line."
