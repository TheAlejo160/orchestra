# orchestra

[Español](README.es.md) · **English**

**A team of AI agents that works like a senior engineer who wastes nothing.**

orchestra is a mod (plugin) for [Claude Code](https://claude.com/claude-code). It hands each part of a task to the cheapest model that does that part well. That can be a Claude subagent or an agent from another CLI you have installed: Codex, Antigravity/Gemini, OpenCode, GitHub Copilot or Kimi. The agents coordinate without stepping on each other, and one pane shows you everything they do.

The repository also contains:

- **The `orchestra` skill**, the mod's efficiency mode. The skill also works on its own in Codex, Copilot, Gemini, OpenCode and Kimi.
- **A master prompt** that builds or upgrades the mod on your machine for the agents you have.

---

## What's inside

| File | What it is |
|---|---|
| `hooks/register.tsx` | The mod: routing, the `delegate` tool, the shared board, the file guard, the Haiku relay, lean mode and the pane. |
| `skills/orchestra/SKILL.md` | The skill: efficiency and orchestration rules (short answers, minimal complete code, judging which model to use, lean briefs). |
| `PROMPT-MAESTRO.md` | A prompt, in Spanish, to paste into Claude Code. It detects your agents, asks about your plans, and builds or upgrades the mod. |
| `install-skill.sh` | Copies the skill into the skill folders of the agents installed on your machine. |
| `hooks/register.test.ts` | The mod's tests, run with `claude plugin test`. |

## How it works

1. **Routing by judgment, not by a fixed recipe.** Every session, the mod reads the models each CLI offers your account *right now*. It hands them to the main chat with their descriptions, context windows and effort levels. For each part, the chat weighs:
   - the kind of work;
   - how hard it is;
   - how much context it needs;
   - whether it needs the chat's own tools;
   - cost: free models first, then other plans' quotas, then your Claude Code limits last.

   **If you name a model, that model is used.**
2. **External agents in the background.** The `delegate` tool runs Codex, AGY, OpenCode, Copilot or Kimi on a self-contained task. It claims the agent's files and follows its activity live. When the agent finishes, its report goes to `.orchestra/reports/`. Optionally, a *different* model reviews the work.
3. **Coordination.** The agents share three things:
   - a board (the `board` tool, plus `.orchestra/BOARD.md` for external agents), where they message each other or a whole group;
   - a guard that stops two agents from editing the same file at once;
   - a record of who edits, reads or audits each file, and which functions they touch.
4. **Haiku relay.** Haiku condenses long notes and reports before they reach other agents or the main chat. If Haiku would drop a path or an identifier, the original goes through instead.
5. **Lean mode, on by default.** The chat, the Claude subagents and the external agents all get efficiency rules: answer first with no filler, make the smallest complete change, read only what is needed, keep reports to a few lines. `/orchestra lean off` turns it off.
6. **One pane** (`/orchestra`), the same in the CLI and the desktop app. From top to bottom:
   - **Usage:** what is used and what is left of the 5-hour and weekly limits, when each resets, and the chat's context.
   - **Orchestra:** groups, then one collapsible row per provider. Each agent shows its model, effort, context %, task, the files it edits and reads, and the functions it touches.
   - **Files:** who does what on each file.
   - **Working together:** who talks to whom, and who waits on whom.
   - **Agent:** one agent's card and its conversation.
   - **Message the team:** a box to write to an agent or a group yourself.
   - **Haiku relay:** a switch to turn it on or off.

## Requirements

- **A recent Claude Code with mod support** (plugin hooks modules). Tested on 2.1.318.
- **Optional:** any of these CLIs, signed in by you: `codex`, `agy` (Antigravity), `opencode`, `copilot`, `kimi`. The mod ignores the ones you don't have, and it works with Claude alone.

## Install in Claude Code

In a terminal:

```bash
claude plugin marketplace add TheAlejo160/orchestra
```

```bash
claude plugin install orchestra@orchestra
```

Or at the Claude Code prompt:

```
/plugin install orchestra --marketplace TheAlejo160/orchestra
```

Restart Claude Code. The pane opens by itself. After that:

- `/orchestra` reopens the pane.
- `/orchestra lean on|off` turns lean mode on or off.
- The skill `orchestra:orchestra` ships inside the plugin, and Claude loads it when needed. You never have to invoke it.

To update:

```bash
claude plugin marketplace update orchestra
```

```bash
claude plugin update orchestra@orchestra
```

## Not using Claude Code? (Codex, Copilot, Gemini, OpenCode, Kimi, Cursor…)

**The mod runs only in Claude Code,** because it is built on Claude Code's plugin API: the pane, the hooks and the tools. **The skill works in any agent that reads `SKILL.md` files.** Without the mod you get no pane, file guard, board or relay. You still get:

- short answers and minimal, complete code;
- judgment on which model and effort to use;
- lean briefs;
- review by a different model, where the agent can run subagents of its own.

To install the skill into the agents you have:

```bash
git clone https://github.com/TheAlejo160/orchestra && sh orchestra/install-skill.sh
```

The script only copies `skills/orchestra/SKILL.md`, into these folders for the CLIs it finds:

| Agent | Personal skills folder |
|---|---|
| Claude Code (the skill only, without the mod) | `~/.claude/skills/` |
| OpenAI Codex | `~/.codex/skills/` and `~/.agents/skills/` |
| GitHub Copilot CLI | `~/.copilot/skills/` and `~/.agents/skills/` |
| Gemini CLI / Antigravity | `~/.gemini/skills/` |
| OpenCode | `~/.config/opencode/skills/` |
| Kimi Code | `~/.kimi-code/skills/` |
| Cursor and others | Copy it by hand into the skills or rules folder your agent uses. |

These folders can change between CLI versions. If the script doesn't find yours, check that CLI's docs.

## The master prompt

`PROMPT-MAESTRO.md` is written for Claude Code, in Spanish; Claude follows it just as well in any language. It does two things:

- **Without the mod:** it builds the mod from scratch.
- **With the mod:** it compares it with the spec and proposes upgrades.

Either way, it first detects the agents you have installed, including Cursor, Z.ai/GLM, Qwen and others. From each CLI's own `--help` and a test run, without inventing flags, it works out how to run it without prompts. Then it asks about your plan for each agent and the order to spend quotas in, and saves your answers to a config file you can edit later. Paste it as the first message of a new session.

## Security

- **The mod never asks for, reads or stores credentials.** Each CLI uses the session you signed in yourself.
- **External agents in write mode can edit your project.** Use `write: false` for reviews and surveys. Each CLI has its own sandbox; Antigravity's keeps commands inside the project.
- **The file guard covers edits by Claude subagents only.** External CLIs edit outside it, so the mod claims the files they touch as it sees them, to warn the other agents off.
- **`.orchestra/`**, which holds the reports and the board, has its own `.gitignore` and stays out of your commits.
- **The Haiku relay sends long notes to Haiku,** on your Claude account, to condense them. You can turn it off in the pane.
- **This repository contains no one's personal data:** no paths, no accounts, no usage reports.

## Development

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

To add a provider, write five pieces:

- a model loader;
- the `argv` that launches it;
- a reader for its JSON output;
- its account-refusal patterns;
- a cost note.

Copy the pattern of an existing provider, add a test with a simulated process, and open a PR.

## License

MIT. See [LICENSE](LICENSE).
