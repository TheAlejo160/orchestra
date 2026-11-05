# Master prompt: "orchestra" for Claude Code

**English** · [Español](PROMPT-MAESTRO.md)

This prompt has two uses:

- **Build** the mod from scratch on a machine that does not have it.
- **Upgrade** an orchestra mod that already exists to what this document describes, keeping everything that already works.

It detects which AI agents are installed on the machine and adapts to them. Each agent can be turned on, turned off or configured without touching code.

**How to use it:** open a new Claude Code session (CLI or desktop app). Open it in the folder where you want the mod, or in the folder of the mod you already have. Copy everything below the line and paste it as the first message. You can add a last line with whatever you want changed, for example: "no Kimi; Copilot always on auto; add Cursor".

---

I want you to build or upgrade a Claude Code mod called **orchestra**: a multi-agent orchestrator. It splits work between Claude subagents and the agents of other CLIs installed on my machine, makes them coordinate without stepping on each other, and shows it all in a pane.

## 0. Working rules (before anything else)

1. Load the `plugin-authoring` skill and follow its rules: where the mod goes, the type contract, `claude plugin validate`, `claude plugin test` and `tsc`.
2. Before you use any `$` API, look it up in the type declarations the skill names and read its declaration. **Do not invent APIs, events or props.** If something I ask for does not exist in the API, tell me and propose the closest alternative.
3. **Do not invent flags or formats for any CLI.** For each external CLI, get its usage from its own `--help`, from its installed docs, and from a minimal test run in a temporary directory. If you cannot confirm something, mark it "unverified" and tell me.
4. Never ask for, read or write credentials, tokens or keys. If a CLI is not signed in, tell me the command so I can sign in myself.
5. Do not change the CLIs' global configuration. The mod only reads what it needs.
6. Before you download or install anything, ask me first, and say what it is, where it comes from and how big it is.
7. Work in phases, and show me the results of phases 1 and 2 before you write any code.

## 1. Phase 1: detect the environment

### 1.1 Build or upgrade?

- Look for an existing orchestra: in the current folder, in `~/.claude/plugins/installed_plugins.json` (the `orchestra@…` entry), and in the development mods folders the skill names.
- If one exists, read it **in full**, including its tests, its type contract and its `plugin.json`. Make a table of every feature in sections 3 to 9, marked "done", "done differently" or "missing". That table is the basis of phase 2.
- If none exists, build it from scratch.

### 1.2 Agent inventory

Always use a login shell to inherit my PATH: `/bin/zsh -lc '…'` on macOS, `bash -lc '…'` on Linux. Check at least these candidates. Also check any other AI agent for the terminal that you find on the PATH or in `~/.local/bin`, `~/.npm-global/bin`, `~/.bun/bin`, `/opt/homebrew/bin` and `~/.<name>/bin`:

| Candidate | Binaries to look for |
|---|---|
| OpenAI Codex | `codex` |
| Google Antigravity / Gemini | `agy`, `gemini` |
| OpenCode | `opencode` |
| GitHub Copilot CLI | `copilot` |
| Kimi Code | `kimi` |
| Cursor (its terminal agent; the IDE alone will not do) | `cursor-agent`, `agent` |
| Z.ai / GLM (whatever its CLI is called) | `zcode`, `zai`, `glm` |
| Qwen Code | `qwen` |
| Any others that turn up | `aider`, `crush`, `amp`, `goose`, … |

For each binary you find, work out and note:

- **Non-interactive mode:** the flag that passes a prompt and exits (`exec`, `-p`, `run`, …).
- **Machine-readable output:** JSON or stream-json. Get the real shape of each line from a test run: `Reply with exactly: OK`.
- **How it lists its models.** Always use the freshest source: a command of the CLI itself before a cache file, because a cache can come from an older CLI version and list old models. For each model, note its id, its description or display name, its context window and the effort levels it accepts.
- **Effort or reasoning:** how it is passed and which values it accepts. Some CLIs carry it in the model id, such as `-low` or `-high`.
- **Permissions:** how to run read-only, and how to approve edits without prompts. Confirm what the CLI does in non-interactive mode when a tool asks for confirmation: some refuse it silently and end with no answer.
- **Sandbox:** whether it keeps commands inside the project. Test it: a `touch` outside the project must fail.
- **How it reports the end:** final message, output file, tokens used and errors.
- **Account errors:** what "plan has no access", "out of credits", "limit reached" and "not signed in" look like, so the mod can recognize them later.
- **Whether it is signed in.**

If an agent that usually installs separately from its app is missing (Cursor, for example), tell me and ask whether to install it. Do not install it without my yes.

### 1.3 Ask me about each agent

Show me a table of each detected agent (version, models, whether it is signed in, what stayed unverified). Then ask me, all in one go:

- Which ones to turn on and which to leave off.
- **Which plan I have on each one** (free, student, Pro, paid, none) and what each task spends: tokens, premium requests or quota.
- Whether any must always run on automatic, with no model or effort chosen. For example: Copilot, on a plan where the CLI itself picks the model, always runs on `auto`.
- Which model to use by default when I name none. For example, in OpenCode, the free model I prefer.
- Which models of each CLI to **exclude**.
- **The spending order:** which quotas to spend before the Claude Code limits. For example: Antigravity offers Claude Opus and Sonnet on its own quota, so it is worth spending that before the Claude Code 5-hour and weekly limits.

Save my answers to a user config file that the mod reads at startup, for example `~/.config/orchestra/providers.json`. Then I can edit it later without touching code: turn an agent on or off, change its plan, its default model or its exclusions, or add a new agent. If an agent in the file is not installed, the mod ignores it and says so.

## 2. Phase 2: the plan

Tell me in a short list:

- What you will build or change.
- Which agent adapters you will write.
- What stayed unverified.

When upgrading, also say what stays as it is. Wait for my "yes" before you go on.

## 3. Architecture

```
orchestra/
  .claude-plugin/plugin.json        name, version, description, "types": "./types/index.d.ts"
  .claude-plugin/marketplace.json   to install it with /plugin install (only if I ask)
  hooks/hooks.json                  { "modules": ["./register.tsx"] }
  hooks/register.tsx                hooks, tools, pane
  hooks/providers.ts                one adapter per external agent (if the API lets the module import the plugin's files; check)
  hooks/register.test.ts            tests
  types/index.d.ts                  the $.state contract (PluginState.orchestra)
```

**Agent adapter.** Every external agent is an object of the same shape. Adding a new one (Cursor, Z.ai, …) must take only an adapter and a config entry, without touching the rest:

```ts
type Adapter = {
  id: string                       // 'codex', 'agy', 'cursor', …
  name: string                     // name in the pane
  detect: () => Promise<boolean>   // installed and signed in?
  listModels: () => Promise<Model[]>   // freshest source; only the newest generation of each line if the CLI lists several
  argv: (task: Task, prompt: string, reportPath: string) => string[]   // read or write, model, effort
  readLine: (line: string) => StreamFact   // activity, files read and edited, tokens, real model, final text, error, cost
  refusal: RegExp                  // account errors: plan, credits, quota, sign-in
  autoOnly?: boolean               // never pass a model or effort (e.g. Copilot on auto)
  defaultModel?: (models: Model[]) => string | undefined
  costNote: string                 // what it spends, for the routing text
}
type Model = { provider: string; id: string; name: string; window: number; efforts: string[]; blocked?: string }
```

**State** goes in `$.state`, with `atom()`, `read()` and `update()`, all declared in the contract:

- `main`: the main chat
- `agents`, `claims`, `touches`, `notes`, `log`, `limits`, `catalog`, `groups`
- `team`: the pane's selection and open sections
- `relay`

What lasts across sessions goes in `$.store`: the catalog, so the mod starts without waiting; account blocks with their expiry; and the monthly counts of premium requests. If you change the shape of a stored value, use the `shape` tag the skill explains.

## 4. Routing the work (the most important part)

It goes in a `prompt.compose` section (`scope: 'session'`) generated from the **live** catalog. It offers only models the account accepts.

**It is not a fixed recipe.** The orchestrator decides part by part, by judgment:

1. **If I name models, providers or an effort** for something, use exactly those for those parts, and judge only the rest.
2. Otherwise, for each part, pick the model that fits best, weighing:
   - **the kind of work:** plan, design, architecture, implementation, mock-up, research, finding images, review, audit or text;
   - **how hard it is;**
   - **how much context it needs:** heavy work goes to the largest windows in the catalog;
   - **whether it needs this chat's tools, skills or context:** then it goes to a Claude subagent;
   - **what it costs**, in this order: free first; then other plans' quotas, including a provider's own quota for Claude models; the Claude Code limits last, and only for what truly needs them.
3. Set the **effort to the part, not to the model:** low for mechanical work, medium for routine, high for real design and logic, xhigh/max only for the hardest reasoning.
4. Mix providers when it helps: one plans, others build separate pieces in parallel, and **a different model** reviews or audits. Use as few agents as the task needs. The orchestrator does a small task alone.
5. When launching agents, say in one line which model does which part and why, so I can redirect.

For the judgment to work, the routing text includes:

- For each model: its id, **the description its own CLI gives**, its window and its effort levels.
- One line per provider with what it is **usually** good for and what it spends. That line is a starting point, not a rule.
- The difficulty tiers (complex, medium, small), with each tier's models classified by their id and description. A model may sit in two tiers.

**Claude subagents.** Register them with `$.agent.register` in `session.start`:

- `architect` (opus, high)
- `builder` (sonnet, medium)
- `reviewer` (sonnet, high): reviews another agent's finished work, runs the tests and posts its verdict.
- `polisher` (haiku, low)

The routing text says that every Agent call sets `model` and `effort` for its part, even when that differs from the role's default. Every role carries the team rules: edit only its own files; if an edit is refused, do not work around it with Bash, but write to the owner on the board; read the board when starting; finish with a short report.

## 5. The `delegate` tool

`$.tool.register`, with `isDeferred: false`.

- **action:** `start` (the default), `stop`, `list` or `probe`.
- **Parameters:** `provider`, `task` (complete instructions, because the agent does not see the chat), `label`, `model`, `effort`, `write` (false = read-only), `files` (the absolute paths it owns), `group`, `reportTo` (who reads the report and acts on it), `review` (the reviewing provider, different from the author), and options of the adapter's own, such as `fast`.

**At start:**

- Validate the provider and model against the catalog. If the request does not exist or is blocked, answer with the available models.
- If the adapter is `autoOnly`, ignore the requested model and effort. With no model, use the adapter's `defaultModel`.
- Refuse to start if another running agent holds a requested file.
- Claim the files, register the agent and answer at once. The process runs in the background with `$.process.spawn`, always through the login shell: `['/bin/zsh','-lc','exec "$0" "$@"', …argv]`.

**While it works:** read the stream with the adapter's `readLine` and update the activity, tokens, real model, files read and files edited live. Claim whatever an external agent edits as you see it, because the CLIs edit outside Claude's guard.

**Its prompt includes:**

- its name, its group and the group's goal;
- its files, and the files other agents hold;
- the running agents;
- the notes for it or its group;
- the shared board `.orchestra/BOARD.md`, which it must read again before it touches a shared file and before it finishes;
- who will read its report;
- the path `.orchestra/reports/<YYYYMMDD-HHMM>-<id>.md` and the report format: `## Summary`, `## Files changed`, `## How I checked it`, `## Left undone or risky`, `## Messages` (lines `TO <agent or group>: …`).

If the CLI has a flag that saves its final message, use it. If not, the agent writes the file and repeats the report at the end.

**When it finishes:**

- Rewrite the report with a header: agent, model, effort, group, who asked, who it is for, reviewer and status. Below it go the task, the report, `## Activity`, and the stderr tail if it failed.
- An empty report counts as a failure, even when the exit code is 0.
- Post the summary and the path to the board for `reportTo` (and for whoever asked), along with its `TO` lines. Release its files.
- If the orchestrator asked for it, call `$.prompt.submit` with the summary and the path, **not** the whole report.
- If there is a `review`, launch the reviewer: an `orchestra:reviewer` for Claude, or a read-only `delegate` on another provider. If the reviewer's provider is unavailable, use Claude.

**Account refusals:**

- If the error matches `refusal`, block that model, or the whole CLI when the error is about sign-in or the account. Rate limits expire after 2 h and the rest after 72 h; store the block in `$.store`.
- Retry **once** on another model of the same tier in the same CLI.
- Stop offering what is blocked in the routing text. `probe` sends each model a minimal prompt, 4 at a time, and updates the blocks.

**Files:** `.orchestra/` carries its own `.gitignore` containing `*`.

## 6. Coordination between agents

- **The `board` tool.**
  - `read` returns, in this order: the notes for me or my group, the groups with their goals, the running agents with what they are doing, the claimed files, and the latest notes.
  - `post` publishes a note with an optional `to` (an agent, a group or `orchestrator`).
  - `group` sets a group's goal.

  The mod keeps `.orchestra/BOARD.md` up to date for the external agents.
- **Tolerant recipient:** if `to` arrives in another case, as "Group: name", or with half the name, deliver it to the agent or group it means.
- **File guard:** a `tool.call` hook on Edit, Write, MultiEdit and NotebookEdit makes the subagent claim the file when it edits it. If another running agent holds the file, the hook returns `{ deny }` with the owner's name and logs the wait. The orchestrator takes no claims. No `.catch`, so a bug in the mod never blocks work. Claims are released when the agent finishes.
- **Who does what on each file (`touches`):**
  - Per file and per agent, store the role (`edits`, `audits`, `reads` or `plans`) and the functions or classes its edits hit, taken from Edit's `old_string`/`new_string`.
  - A `Write` counts as "whole file". A Read or Grep on a file counts as a read.
  - A reviewer audits and a planner plans.
  - For external agents, use the files read and edited from their stream.
- **Automatic groups:**
  - A description of the form "Group: name" sets the group.
  - Otherwise the agent inherits its parent's group.
  - Failing that, it joins the group of its kind of work (Design, Build, Review, Polish, Research, Planning), each with its default goal.
  - If none applies, the goal is "Working on: <first agent's task>".
- **Haiku relay:**
  - Condense long notes (over about 280 characters) and final reports with `$.model.complete({ model: 'haiku', effort: 'low', timeoutMs })` before they reach the board and the main chat.
  - Rules for Haiku: keep paths, identifiers, numbers, commands, errors, and who must do what, word for word.
  - If the result lacks a path or identifier from the original, or Haiku fails, send the original.
  - It can be turned on and off from the pane, which shows how much it has condensed.

## 7. The pane

One pane: `$.ui.open` plus a `ui.render` hook on `Pane`, using the elements of `$.ui.resolve(e)`. It must work the same in the **CLI** and in the **desktop app**. Phones have no `Input` or `Select`: check with `'Input' in ui` and leave that part read-only. Use sections as cards (`Box` with `borderStyle="round"`, `paddingX`), each with a colored title. From top to bottom:

1. **Usage** (always on top and always visible):
   - `5h` and `Week`: a bar colored by threshold, `% used · % left`, and the reset in local time (with the day when it is not today) plus a countdown.
   - Data comes from `$.session.usage()` at startup and from the `session.measure` event. The countdown refreshes every 60 s with `$.clock.every` and `$.ui.invalidate`.
   - Below: the main chat's context (bar, k/total, %, model, effort) and the month's premium request counts.
2. **Orchestra:**
   - At the top, the groups with their goals and how many of their agents are running.
   - Below, **one collapsible row per provider**: a `plain` `Button` with a stable `key`, also opened in the CLI by a digit `hotkey`. Closed, it shows only the summary ("▸ Codex · 2 running · 1 done · api, footer").
   - Open, it shows per agent:
     - status, name, group and type;
     - model, effort, and `ctx` with a bar, k/total and %, **against the model's maximum window** (a subagent on the same model as the chat takes the chat's real window);
     - the task and who asked for it;
     - what it is doing now;
     - `✎ edits file (functions)`, and `◎ reads` / `◉ audits` / `◇ plans`;
     - who it talks to;
     - the path of its report.
3. **Files:** the files in use by running agents, those with several agents first and marked with their agent count. Per file, one line per agent with its icon, name, provider, role and the functions it touches.
4. **Working together:**
   - the pairs that have messaged each other (`a ⇄ b · N msgs · last message`);
   - the current waits (`⏸ x waits on y: file`);
   - a collapsible "Activity" with assignments, claims, waits, notes and finishes.
5. **Agent:** a `Select` to pick an agent and see its card and conversation, with the buttons "Ask for status" and "Stop" (Stop for external agents only).
6. **Message the team:** a recipient `Select` (agent, group or orchestrator) and an `Input` with a Send button. The message reaches the board as a note from "you".
7. **Haiku relay:** ON/OFF, how much was condensed and the tokens saved, with the switch button on the same row.

Also: the `/orchestra` command, which opens the pane, and `$.ui.status` showing "orchestra: N running".

## 8. Tests and verification

Write tests with `claude-code/testing`. Mount the pane on `terminal` **and** `desktop`, and open the providers before looking for their rows. At least check:

- The limits: used, left and reset.
- Claims, waits and note delivery.
- Each simulated adapter, with `process.spawn` as a generator and `process.run`: correct argv, stream reading, claimed files, and the report on the board.
- That only the newest generation of each model line is offered.
- That an `autoOnly` agent never receives a model or effort.
- That the default model is used when none is requested.
- Account refusals: the model or CLI gets blocked and the run retries once.
- An agent with no report, which ends as a failure.
- The automatic reviewer.
- The relay: it condenses, and lets the original through when a path would be lost.
- Several agents on one file: their roles and functions.
- The pane: folding and unfolding, picking an agent, sending a message, and switching the relay.

Remember that in the test harness, stubs for `$` nouns return `{ value: … }`, and use `mock.clock` and `mock.store`.

Pass `claude plugin validate`, `claude plugin test`, and `tsc` with no errors in `register.tsx`.

Test each active CLI by hand in a temporary directory, with a minimal task that runs a command and writes the report.

If the mod is installed from a local marketplace, bump the version in `plugin.json`, then run `claude plugin marketplace update <marketplace>` and `claude plugin update orchestra@<marketplace>`.

## 9. What to tell me when you finish

- The mod's path, how it loads (hot reload, `--plugin-dir`, or a restart if it was installed), and what stayed untested.
- That the external CLIs' write modes let them edit the project, and what sandbox each one has.
- That every external agent that finishes opens a turn in the main chat.
- That the Haiku relay spends a little of the Claude limits, and only on long messages.
- Which CLIs do not report the functions they edit, so the pane shows only the file for them.
- That only one agent edits a file at a time, while the others can read or audit it. If I want several to edit different functions of the same file at once, the guard must change to per-function claims.
