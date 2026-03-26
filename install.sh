#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.claude/statusline-command.sh"
SETTINGS="$HOME/.claude/settings.json"

echo "Installing Claude Code status line..."

# Create .claude directory if needed
mkdir -p "$HOME/.claude"

# Copy script
cp "$SCRIPT_DIR/statusline.sh" "$DEST"
chmod +x "$DEST"
echo "  Copied statusline.sh -> $DEST"

# Configure settings.json
if [ -f "$SETTINGS" ]; then
  # Check if statusLine already configured
  if jq -e '.statusLine' "$SETTINGS" >/dev/null 2>&1; then
    echo "  statusLine already configured in $SETTINGS"
  else
    # Add statusLine to existing settings
    tmp=$(mktemp)
    jq '. + {"statusLine": {"type": "command", "command": "bash '"$DEST"'"}}' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
    echo "  Added statusLine config to $SETTINGS"
  fi
else
  # Create new settings file
  cat > "$SETTINGS" << EOF
{
  "statusLine": {
    "type": "command",
    "command": "bash $DEST"
  }
}
EOF
  echo "  Created $SETTINGS with statusLine config"
fi

echo ""
echo "Done! Restart Claude Code to see your new status line."
