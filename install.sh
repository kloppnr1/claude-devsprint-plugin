#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"

# Verify we're in the repo root
if [[ ! -f "$SCRIPT_DIR/bin/azdev-tools.cjs" || ! -d "$SCRIPT_DIR/commands" ]]; then
  echo "Error: must run from the claude-azdev-skill repo root."
  echo "  cd /path/to/claude-azdev-skill && ./install.sh"
  exit 1
fi

echo "Installing claude-azdev-skill..."
echo

# 1. Commands
mkdir -p "$CLAUDE_DIR/commands"
copied_commands=()
for f in "$SCRIPT_DIR"/commands/azdev*.md; do
  cp "$f" "$CLAUDE_DIR/commands/"
  copied_commands+=("$(basename "$f")")
done
echo "Commands: ${copied_commands[*]}"

# 2. Helper script
mkdir -p "$CLAUDE_DIR/bin"
cp "$SCRIPT_DIR/bin/azdev-tools.cjs" "$CLAUDE_DIR/bin/"
echo "Helper:   azdev-tools.cjs"

# 3. Remove obsolete files
removed=()
if [[ -f "$CLAUDE_DIR/commands/azdev.md" ]]; then
  rm "$CLAUDE_DIR/commands/azdev.md"
  removed+=("commands/azdev.md")
fi
if [[ ${#removed[@]} -gt 0 ]]; then
  echo "Removed:  ${removed[*]}"
fi

echo
echo "Done. Restart Claude Code to pick up changes."
