#!/bin/bash
set -e

# claude-devsprint-plugin v2 — persistent sprint context installer

CLAUDE_DIR="$HOME/.claude"
COMMANDS_DIR="$CLAUDE_DIR/commands"
PLUGIN_NAME="claude-devsprint-plugin"
VERSION="2.0.0"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo ""
echo "claude-devsprint-plugin v${VERSION}"
echo "Your agent finally (kinda) knows your project."
echo "-------------------------------------------"
echo ""

# Create Claude directories if they don't exist
mkdir -p "$COMMANDS_DIR"

# Determine script location (works whether run directly or via curl | bash)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Install slash commands
echo "Installing commands..."
for cmd in sprint-init sprint-update sprint-status sprint-reset; do
  src="$SCRIPT_DIR/commands/${cmd}.md"
  dest="$COMMANDS_DIR/${cmd}.md"
  if [ -f "$src" ]; then
    cp "$src" "$dest"
    echo -e "  ${GREEN}✓${NC} /${cmd}"
  else
    echo -e "  ${RED}✗${NC} /${cmd} — source not found at $src"
    exit 1
  fi
done

# Install sprint context template
TEMPLATE_SRC="$SCRIPT_DIR/templates/sprint-context.md"
TEMPLATE_DEST="$CLAUDE_DIR/sprint-context-template.md"
if [ -f "$TEMPLATE_SRC" ]; then
  cp "$TEMPLATE_SRC" "$TEMPLATE_DEST"
  echo -e "  ${GREEN}✓${NC} sprint-context-template.md"
else
  echo -e "  ${RED}✗${NC} Template not found at $TEMPLATE_SRC"
  exit 1
fi

# Check if v1 commands exist, offer upgrade note
V1_COMMANDS=("devsprint-setup" "devsprint-sprint" "devsprint-create" "devsprint-plan" "devsprint-execute" "devsprint-pr-fix")
V1_FOUND=false
for cmd in "${V1_COMMANDS[@]}"; do
  if [ -f "$COMMANDS_DIR/${cmd}.md" ]; then
    V1_FOUND=true
    break
  fi
done

if [ "$V1_FOUND" = true ]; then
  echo ""
  echo -e "${YELLOW}Note:${NC} v1 devsprint commands detected. They still work — v2 adds context persistence on top."
fi

echo ""
echo -e "${GREEN}Installation complete!${NC}"
echo ""
echo "Get started in any project:"
echo ""
echo "  /sprint-init     — Set up persistent context for this project"
echo "  /sprint-update   — Update context after a working session"
echo "  /sprint-status   — See what's in progress and what's next"
echo "  /sprint-reset    — Archive and start a new sprint"
echo ""
echo "Run /sprint-init in your project directory to start."
echo ""
