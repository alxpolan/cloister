#!/usr/bin/env bash
# Bootstrap: install the `cloister` / `agents` CLI, then boot the whole stack.
# After this, everything is driven by the CLI:  cloister up · agents <company>
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"

command -v node >/dev/null 2>&1 || { echo "Node.js 18+ is required — https://nodejs.org"; exit 1; }
chmod +x cli/cli.mjs

target=""
for dir in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin"; do
  if [ -d "$dir" ] && [ -w "$dir" ]; then target="$dir"; break; fi
done
if [ -z "$target" ]; then mkdir -p "$HOME/.local/bin"; target="$HOME/.local/bin"; fi
ln -sf "$ROOT/cli/cli.mjs" "$target/cloister"
ln -sf "$ROOT/cli/cli.mjs" "$target/agents"
echo "→ installed 'cloister' and 'agents' to $target"
case ":$PATH:" in
  *":$target:"*) ;;
  *) echo "  add it to your PATH:  echo 'export PATH=\"$target:\$PATH\"' >> ~/.zshrc && source ~/.zshrc";;
esac

exec "$target/cloister" up
