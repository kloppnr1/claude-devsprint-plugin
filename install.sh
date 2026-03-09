#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"

# Verify we're in the repo root
if [[ ! -f "$SCRIPT_DIR/bin/devsprint-tools.cjs" || ! -d "$SCRIPT_DIR/commands" ]]; then
  echo "Error: must run from the claude-devsprint-plugin repo root."
  echo "  cd /path/to/claude-devsprint-plugin && ./install.sh"
  exit 1
fi

echo "Installing claude-devsprint-plugin..."
echo

# 1. Commands
mkdir -p "$CLAUDE_DIR/commands"
copied_commands=()
for f in "$SCRIPT_DIR"/commands/devsprint*.md; do
  cp "$f" "$CLAUDE_DIR/commands/"
  copied_commands+=("$(basename "$f")")
done
echo "Commands: ${copied_commands[*]}"

# 2. Helper script
mkdir -p "$CLAUDE_DIR/bin"
cp "$SCRIPT_DIR/bin/devsprint-tools.cjs" "$CLAUDE_DIR/bin/"
echo "Helper:   devsprint-tools.cjs"

# 3. Remove obsolete commands (old azdev-* and devsprint-* files not in repo)
removed=()
for pattern in "$CLAUDE_DIR"/commands/azdev*.md "$CLAUDE_DIR"/commands/devsprint*.md; do
  for installed in $pattern; do
    [[ -f "$installed" ]] || continue
    basename="$(basename "$installed")"
    if [[ ! -f "$SCRIPT_DIR/commands/$basename" ]]; then
      rm "$installed"
      removed+=("$basename")
    fi
  done
done
# Remove old azdev-tools.cjs if present
if [[ -f "$CLAUDE_DIR/bin/azdev-tools.cjs" ]]; then
  rm "$CLAUDE_DIR/bin/azdev-tools.cjs"
  removed+=("azdev-tools.cjs")
fi
if [[ ${#removed[@]} -gt 0 ]]; then
  echo "Removed:  ${removed[*]}"
fi

echo
echo "Done. Restart Claude Code to pick up changes."
echo
echo "Dashboard: node $SCRIPT_DIR/dashboard/server.cjs --cwd <your-project-path>"
echo "  Opens at http://localhost:3000"
