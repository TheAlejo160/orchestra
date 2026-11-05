#!/bin/sh
# Copies the orchestra skill into the skill folders of the agents installed on this machine.
# It only copies one SKILL.md; it reads and changes nothing else.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
src="$here/skills/orchestra/SKILL.md"
[ -f "$src" ] || { echo "skills/orchestra/SKILL.md not found next to this script" >&2; exit 1; }

install_to() { # $1 skills folder, $2 agent name
  mkdir -p "$1/orchestra" && cp "$src" "$1/orchestra/SKILL.md" && echo "installed for $2: $1/orchestra/SKILL.md"
}

found=0
command -v claude   >/dev/null 2>&1 && { install_to "$HOME/.claude/skills" "Claude Code (skill only; install the plugin for the full mod)"; found=1; }
command -v codex    >/dev/null 2>&1 && { install_to "$HOME/.codex/skills" "Codex"; found=1; }
command -v copilot  >/dev/null 2>&1 && { install_to "$HOME/.copilot/skills" "GitHub Copilot CLI"; found=1; }
{ command -v agy >/dev/null 2>&1 || command -v gemini >/dev/null 2>&1; } && { install_to "$HOME/.gemini/skills" "Gemini CLI / Antigravity"; found=1; }
command -v opencode >/dev/null 2>&1 && { install_to "$HOME/.config/opencode/skills" "OpenCode"; found=1; }
command -v kimi     >/dev/null 2>&1 && { install_to "$HOME/.kimi-code/skills" "Kimi Code"; found=1; }
# The shared folder that several agents also read.
install_to "$HOME/.agents/skills" "agents that read ~/.agents/skills"
[ "$found" = 1 ] || echo "No known agent CLI found on PATH; only ~/.agents/skills was written."
