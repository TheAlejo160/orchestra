import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type {
  OrchestraAgent,
  OrchestraClaim,
  OrchestraEvent,
  OrchestraExternal,
  OrchestraLimit,
  OrchestraModel,
  OrchestraNote,
  OrchestraProvider,
  OrchestraTeamView,
  OrchestraTouch,
} from '../types'

const PANE = 'orchestra'
const main = atom({ plugin: 'orchestra', key: 'main' } as const, null)
const agents = atom({ plugin: 'orchestra', key: 'agents' } as const, {})
const claims = atom({ plugin: 'orchestra', key: 'claims' } as const, {})
const notes = atom({ plugin: 'orchestra', key: 'notes' } as const, [])
const limits = atom({ plugin: 'orchestra', key: 'limits' } as const, [])
const log = atom({ plugin: 'orchestra', key: 'log' } as const, [])
const catalog = atom({ plugin: 'orchestra', key: 'catalog' } as const, [])
const groups = atom({ plugin: 'orchestra', key: 'groups' } as const, {})
const team = atom({ plugin: 'orchestra', key: 'team' } as const, { selected: '', to: '' })
const touches = atom({ plugin: 'orchestra', key: 'touches' } as const, {})
const relayState = atom({ plugin: 'orchestra', key: 'relay' } as const, { isOn: true, count: 0, saved: 0 })

const GENERAL = 'General'

// "UI: nav bar" names the group UI and the agent "nav bar"; no prefix leaves the group to autoGroup.
const splitGroup = (description: string) => {
  const m = /^([^:]{1,24}):\s*(.+)$/.exec(description.trim())
  return m?.[1] && m[2] ? { group: m[1].trim(), label: m[2].trim() } : { group: undefined, label: description.trim() }
}

// An agent nobody grouped joins the group its kind of work belongs to; each has a goal ready.
const ROLE_GROUPS: Record<string, string> = {
  'orchestra:architect': 'Design',
  'orchestra:builder': 'Build',
  'orchestra:reviewer': 'Review',
  'orchestra:polisher': 'Polish',
  'codex:codex-rescue': 'Build',
  Explore: 'Research',
  Plan: 'Planning',
}
const ROLE_GOALS: Record<string, string> = {
  Design: 'Decides structure, layout, visual design and the hard logic',
  Build: 'Implements the planned pieces',
  Review: 'Checks finished work, reports problems and fixes small ones',
  Polish: 'Fixes wording, typos and formatting',
  Research: 'Reads and maps the code without changing it',
  Planning: 'Plans the work before anyone builds',
  General: 'Work not tied to a group',
}
const autoGroup = (type: string, write = true) =>
  ROLE_GROUPS[type] ?? ((EXTERNAL as string[]).includes(type) ? (write ? 'Build' : 'Research') : GENERAL)

// A declared goal wins; then the stock goal of a role group; else what its first agent was asked.
const goalOf = (name: string, declared: Record<string, string>, members: OrchestraAgent[]) =>
  declared[name] ?? ROLE_GOALS[name] ?? (members[0] ? `Working on: ${oneLine(members[0].task, 80)}` : undefined)

const PROTOCOL = `Team rules (other agents edit this project at the same time):
- Edit only the files your task names. Each file you edit is claimed for you until you finish; an edit to a file another agent holds is refused with that agent's name.
- When refused, do not work around it (no Bash writes to that file). Call mcp__orchestra__board with action "post" and "to" set to the owner's name to ask for it or hand that change over, work on something else, and retry after it finishes.
- Something outside your files that needs doing: post it with "to" naming the agent that owns those files, its group, or "orchestrator".
- Read the board (action "read") before you start, and post one line when you finish a file others may depend on.
- Need a second opinion or a big self-contained piece done by another model? mcp__orchestra__delegate runs it on Codex, Antigravity (Gemini), OpenCode (free models), Copilot or Kimi; its report comes back to you on the board.
- Finish with a short report: files changed and anything left undone.`

// --- Lean mode: the efficiency rules every agent of the team follows, on by default -------------------

/** For the orchestrator, added to this chat's system prompt in every session. */
const LEAN_ORCHESTRATOR = `# Orchestra lean mode
Work like a lazy senior engineer and talk like one: every token is paid for, by the person's limits or another plan's.
- Answer first. Short sentences, no greeting, recap or closer, no filler. Code, commands, paths and errors exact.
- Smallest complete change: reuse what the codebase has, then the standard library, then an installed dependency; no abstraction, option or "for later" code nobody asked for; finish every caller, test and fixture the change touches. New non-trivial logic gets one small test.
- Orchestrate only when parts are truly independent; as few agents as the request needs; the cheapest model good enough for each part; effort set to the part.
- Briefs to agents are lean: goal, owned files (absolute paths), constraints, done-check command; bullets, no prose, nothing the agent can read in the code itself.
- Trust digests: open a full report only when the digest leaves a question. Never re-do an agent's work to check it; have a different model review it.
- End a reply with one line: what was not verified, and any risk the person must know.
Before splitting work across agents, load the orchestra:skill skill: it is the long form of these rules.
The person turns this off with /orchestra lean off.`

/** For every subagent, Claude or external. */
const LEAN_AGENT = `Lean rules (save tokens and the person's limits):
- Read only what the task needs: search first, then read the lines that matter. Do not re-read files you already have.
- Smallest complete change in your files: match the surrounding code; no refactors, renames, new dependencies or extra features outside the task; no comments that restate the code.
- Board notes: one line, path:line instead of pasted code.
- Report in at most 10 lines: what changed (files, functions), the check you ran and its result, what is left or risky. No narration of your process.`

const isLean = async ($: EngineInterface) => (await $.store.get('lean').catch(() => undefined)) !== false

const ROLES = [
  {
    name: 'architect',
    model: 'opus',
    effort: 'high',
    description:
      'Hard, high-impact work: project structure, architecture, layout, design system, visual design, animations, complex logic.',
    prompt: `You are the architect on a team of coding agents. You own structure, architecture, layout, visual design and animation. For visual design load the frontend-design skill (and animate for motion) before writing UI. Make decisions a senior engineer would, write production code, and verify what you build.\n\n${PROTOCOL}`,
  },
  {
    name: 'builder',
    model: 'sonnet',
    effort: 'medium',
    description:
      'Routine, well-specified work: components, buttons, forms, labels, copy, image alt text, straightforward edits.',
    prompt: `You are the builder on a team of coding agents. You implement well-specified pieces: components, buttons, forms, labels, copy, alt text, routine edits. Follow the existing structure and style exactly; do not redesign.\n\n${PROTOCOL}`,
  },
  {
    name: 'reviewer',
    model: 'sonnet',
    effort: 'high',
    description:
      'Checks another agent\'s finished work: reads its diff, runs the tests, says on the board whether it is right, and fixes small mistakes in those files.',
    prompt: `You are the reviewer on a team of coding agents. You check work another agent says is finished: read the changed files, run the project's tests or checks, and look for bugs, regressions and missed requirements. Post your verdict on the board to that agent and to "orchestrator" ("ok" or the concrete problems). Fix only small, certain mistakes yourself; hand anything larger back to the author on the board.\n\n${PROTOCOL}`,
  },
  {
    name: 'polisher',
    model: 'haiku',
    effort: 'low',
    description: 'Tiny fixes: typos, wording, punctuation, formatting in text.',
    prompt: `You are the polisher on a team of coding agents. You make small text fixes: typos, wording, punctuation, formatting. Change nothing else.\n\n${PROTOCOL}`,
  },
] as const

type Tier = 'complex' | 'medium' | 'small'

// What each kind of work is for, as the person split it.
const DEEPSEEK_HINT = 'the free DeepSeek model (opencode/deepseek-…-free, the default when you name none)'

const ROLE_OF: Record<OrchestraProvider, string> = {
  claude: 'complex work: architecture, hard logic, cross-cutting changes, final integration. It spends this chat\'s 5-hour and weekly limits, so keep it for what needs it',
  codex: 'implementation: features, refactors, tests and fixes from a clear spec',
  agy: 'reading and quick answers: repo surveys, long logs and docs (1M context), lookups, small edits; and Claude Opus/Sonnet and GPT-OSS on the Antigravity quota, the first place to run a Claude model',
  opencode: `plans and simple to medium integrations, drafts, boilerplate, first review passes; its models are free, so send volume here. Use ${DEEPSEEK_HINT} unless the task needs another`,
  copilot: 'light tasks that need good logic: a tricky function, a focused bug, a second opinion. Copilot always runs on auto: Copilot picks the model, so never name one or an effort. Every task spends premium requests, so send it short tasks, never volume',
  kimi: 'light tasks that need good logic; K3 for complex long-context work. Some Kimi plans do not include Kimi Code; the mod marks the CLI refused when the account says so',
}

// The tiers a model is fit for, by its id; one model can serve two.
const TIER_MATCH: Record<Tier, RegExp> = {
  // Codex lists only its newest generation (newestPerLine), so the line name alone picks the tier.
  complex: /opus|fable|gpt-[\d.]+-(astra|sol)$|gemini-4|argon|(^|[/-])k3$/,
  medium: /sonnet|gpt-[\d.]+-(sol|terra)$|gemini-3\.8-flash-(high|medium)$|deepseek|big-pickle|nemotron-3-ultra|glm|kimi-for-coding$|k3-256k|^auto$/,
  small: /haiku|gemini-3\.8-flash-low$|gpt-[\d.]+-luna$|deepseek|lightning|beam|mimo|minimax|flint|super-vl|nano/,
}
const TIER_NAMES: Record<Tier, string> = {
  complex: 'Complex (architecture, hard logic, big features, final review)',
  medium: 'Medium (well-specified features, integrations, plans, reviews)',
  small: 'Small (reads, quick answers, one-line fixes, text)',
}
const CLAUDE_TIERS: Record<Tier, string[]> = { complex: ['opus', 'fable (only the highest stakes)'], medium: ['sonnet'], small: ['haiku'] }

const tierLine = (all: OrchestraModel[], tier: Tier) => {
  const external = all.filter(m => m.blocked === undefined && TIER_MATCH[tier].test(m.id)).map(m => `${m.provider}:${m.id}`)
  return `- ${TIER_NAMES[tier]}: ${[...CLAUDE_TIERS[tier].map(a => `claude:${a}`), ...external].join(', ')}`
}

const modelList = (all: OrchestraModel[], provider: OrchestraExternal) => {
  const mine = all.filter(m => m.provider === provider)
  if (mine.length === 0) return 'not installed or not signed in on this machine; do not use it.'
  const open = mine.filter(m => m.blocked === undefined)
  const shut = mine.filter(m => m.blocked !== undefined)
  if (open.length === 0) return `unavailable on this account right now (${shut[0]?.blocked}); do not use it.`
  // The CLI's own description, where it says more than the id, is what the orchestrator judges a model by.
  const about = (m: OrchestraModel) => (m.name && m.name.toLowerCase() !== m.id.toLowerCase() ? `, "${oneLine(m.name, 80)}"` : '')
  const listed = open.map(m => `${m.id} (${Math.round(m.window / 1000)}k${m.efforts.length > 0 ? `; effort ${m.efforts.join('|')}` : ''}${about(m)})`).join(', ')
  return `${listed}${shut.length > 0 ? `. Refused by this account, do not use: ${shut.map(m => m.id).join(', ')}` : ''}`
}

const routing = (all: OrchestraModel[], premium: number) => `# Orchestra
The person installed the orchestra mod and wants work split across models by role and difficulty, to save tokens and limits. When a request has two or more independent parts, act as the orchestrator: plan the parts, give each one disjoint files, and launch the agents in one message, in the background, then integrate and verify their work. Do a small single-step task yourself.

How to pick: the kind of work picks the provider, its difficulty picks the tier, and inside the tier take the cheapest model that is good enough. The tiers list only models this machine's accounts accept.

What each provider is usually good for (a starting point for your judgment, not a rule):
${PROVIDER_ORDER.map(p => `- ${p}: ${ROLE_OF[p]}${p === 'copilot' ? ` (${premium} premium requests spent this month)` : ''}`).join('\n')}

Tiers (provider:model):
${(['complex', 'medium', 'small'] as const).map(t => tierLine(all, t)).join('\n')}

Cost: OpenCode is free; Copilot spends premium requests; Codex, agy and Kimi spend their own plans; Claude spends this chat's limits.
Claude models, cheapest source first: agy:claude-opus-5-5-* and agy:claude-sonnet-5-5-* run on the Antigravity quota, so a self-contained task that needs Opus or Sonnet goes there first; use a Claude Code subagent (orchestra:*) when agy refuses it (its quota ran out, and the mod then marks it), or when the work needs this chat's own tools, skills or context. Push volume to free and other plans, keep the plan, the hard decisions and the final integration here, and always have a different provider review.

Claude subagents (Agent tool). Every Agent call sets \`model\` (an alias above; each runs the newest of its line) and \`effort\` to fit the part, overriding the role's default:
${ROLES.map(r => `- orchestra:${r.name} (default ${r.model}, effort ${r.effort}): ${r.description}`).join('\n')}
- Effort low|medium|high|xhigh|max: low/medium for mechanical work, high for most real work, xhigh/max only for the hardest reasoning.
- codex:codex-rescue (OpenAI Codex), when listed: a large self-contained implementation or a second debugging opinion.

External CLI agents (mcp__orchestra__delegate): they run in the background, show in the orchestra pane, claim the files you give them, read the live board in .orchestra/BOARD.md, and leave a report in .orchestra/reports/ that comes back to you as a message. Set reportTo to whoever acts on the report and review to a different provider than the author. Models on this machine:
- codex: ${modelList(all, 'codex')}. Only the newest generation of each line is listed: never ask for an older one. Effort medium or high by default, ultra only for the hardest work; fast: true doubles speed at higher usage.
- agy: ${modelList(all, 'agy')}. Gemini 4 Argon for hard work, Gemini 3.8 Flash for the rest, Claude Opus/Sonnet here before a Claude Code subagent, GPT-OSS for cheap drafts; the id carries its effort.
- opencode (pass the full id): ${modelList(all, 'opencode')}. Default and first pick: the DeepSeek free model. flint is slow.
- copilot: always auto (Copilot picks the model from what the plan allows); do not pass model or effort.
- kimi: ${modelList(all, 'kimi')}.
- A model the account refuses (plan, credits, sign-in) is marked and left out for a while, and the agent retries once on another model of that CLI by itself. delegate action "probe" (with or without provider) re-checks which models answer, at the cost of one tiny prompt each.

Choosing models (judge each part; there is no fixed recipe):
- If the person names models, providers or an effort for the work, use exactly those, for exactly the parts they named; judge only the rest.
- Otherwise pick per part, from the tiers above only, the model whose strengths fit that part best: what kind of work it is (plan, design, architecture, implementation, scaffolding, research, assets, review, audit, text), how hard it is, how much context it must hold (the biggest windows for large codebases and long logs), whether it needs this chat's own tools, skills or context (then a Claude subagent), and what it costs (free models and other plans before this chat's limits, a provider's own quota before Claude Code's). The descriptions next to each model id are the CLIs' own; read them.
- Set the effort to the part, not the model: low for mechanical work, medium for routine, high for real design and logic, xhigh or max only for the hardest reasoning.
- Mix providers when it helps: one plans, others build disjoint pieces in parallel, a different model reviews or audits. Use as few agents as the request needs; a small task is still yours to do alone.
- Say in one line, when you launch them, which model does which part and why, so the person can redirect.

Groups:
- Grouping is automatic: an agent you do not group joins its parent's group, or the group of its kind of work (Design, Build, Review, Polish, Research, Planning), each with a stock goal, and a group without a goal shows what its first agent was asked. Name groups yourself when the request has its own areas: put agents that share one goal in a group and say what the group does: mcp__orchestra__board with action "group", "group" the name and "text" its goal (e.g. group "UI", text "Builds the nav bar and footer"). Name each Claude agent's Agent description "<Group>: <name>" (e.g. "UI: nav bar") and give delegate the same "group". The pane shows each group with its goal, its agents split by provider.
- A note "to" a group name reaches every agent in it.

Working together:
- Give every agent its own files and say which; edits are claimed per agent and a conflicting edit is refused naming the owner. Agents coordinate through mcp__orchestra__board, which you can read too.
- Plan with one agent (or yourself), build in parallel with others, then have a different model review: orchestra:reviewer, or delegate the review to codex or agy, so the author is not the only one who checked. Send problems back to the author on the board or by a new task.
- Use two orchestra:architect agents for big structural work split by area.`

const EDIT_TOOLS: Record<string, string> = {
  Edit: 'file_path',
  Write: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
}

const effortOf = (type: string) => ROLES.find(r => `orchestra:${r.name}` === type)?.effort ?? '-'

// shortcut: a subagent on the main chat's model gets that chat's real window; others 200k unless the id says 1m.
const windowOf = (model: string, chat?: { model: string; window: number } | null) =>
  /\[1m\]/.test(model) ? 1_000_000 : chat && chat.model.replace(/\[1m\]$/, '') === model.replace(/\[1m\]$/, '') ? chat.window : 200_000

const fileName = (path: string) => path.split('/').slice(-2).join('/')

const short = (model: string) => model.replace(/^claude-/, '')

const kTokens = (n: number) => `${Math.round(n / 1000)}k`

const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const bar = (used: number, total: number) => {
  const filled = Math.min(10, Math.round((used / Math.max(1, total)) * 10))
  return '█'.repeat(filled) + '░'.repeat(10 - filled)
}

const LIMIT_NAMES: Record<string, string> = { five_hour: '5h', seven_day: 'Week', spend_limit: 'Spend' }

const PROVIDER_NAMES: Record<OrchestraProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  agy: 'Gemini (AGY)',
  opencode: 'OpenCode',
  copilot: 'Copilot',
  kimi: 'Kimi',
}
const PROVIDER_ORDER: OrchestraProvider[] = ['claude', 'codex', 'agy', 'opencode', 'copilot', 'kimi']
const EXTERNAL = PROVIDER_ORDER.filter((p): p is OrchestraExternal => p !== 'claude')
// The CLIs that take an effort flag; the others run at their configured default.
const TAKES_EFFORT: OrchestraExternal[] = ['codex', 'agy', 'copilot']

const until = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m % 60}m` : `${m % 60}m`
}

// Reset shown as local clock time (weekday too when it is not today) plus the countdown.
const resetLabel = (resetsAt: string | undefined, now: number) => {
  if (resetsAt === undefined) return ''
  const at = new Date(resetsAt)
  if (Number.isNaN(at.getTime())) return ''
  const hm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  const sameDay = at.toDateString() === new Date(now).toDateString()
  const day = sameDay ? '' : `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][at.getDay()]} `
  return ` · resets ${day}${hm} (in ${until(at.getTime() - now)})`
}

const describe = (tool: string, input: Record<string, unknown>) => {
  const target = input.file_path ?? input.notebook_path ?? input.pattern ?? input.command ?? input.description
  return typeof target === 'string' ? `${tool} ${target.slice(0, 60)}` : tool
}

const showStatus = async ($: EngineInterface) => {
  const running = Object.values(await read($, agents)).filter(a => a.isRunning).length
  $.ui.status(running > 0 ? `orchestra: ${running} running` : undefined)
}

const logEvent = ($: EngineInterface, event: OrchestraEvent) =>
  update($, log, list => [...list, { ...event, text: event.text.slice(0, 200) }].slice(-40))

const patchAgent = ($: EngineInterface, id: string, patch: Partial<OrchestraAgent>) =>
  update($, agents, all => (all[id] ? { ...all, [id]: { ...all[id], ...patch } } : all))

// --- Haiku relay --------------------------------------------------------------

const RELAY_RULES = `You relay messages between coding agents from different vendors (Claude, Codex, Gemini, OpenCode, Copilot, Kimi). Rewrite the input as the shortest message that keeps every fact its reader needs: who must do what, decisions, and every file path, identifier, number, command and error text exactly as written. No greeting, no commentary, no headings. Answer with the message only.`

// Paths and code identifiers a condensed message must still carry, or the original goes through.
const MUST_KEEP = /(?:[\w.-]+\/)+[\w.-]+|`[^`]+`|\b[\w-]+\.(?:tsx?|jsx?|mjs|css|html|md|json|py|swift|go|rs|java|kt|ya?ml|toml|sh)\b/g

/** Condenses a long note or report with Haiku so every agent reads (and pays for) less; anything it would drop or any failure keeps the original. */
const relay = async ($: EngineInterface, text: string, kind: 'note' | 'report') => {
  const plain = { text, relayed: false }
  if (text.length <= (kind === 'note' ? 280 : 400) || !(await read($, relayState)).isOn) return plain
  const answer = await $.model
    .complete({
      model: 'haiku',
      effort: 'low',
      maxTokens: kind === 'note' ? 200 : 400,
      timeoutMs: 20_000,
      system: `${RELAY_RULES} ${kind === 'note' ? 'At most 3 short lines.' : 'This is an agent\'s final report: at most 6 short lines covering status, files changed, problems found, and what the reader must do next.'}`,
      prompt: text.slice(0, 12_000),
    })
    .catch(() => undefined)
  const out = answer?.isAnswered ? answer.text.trim() : ''
  if (out === '' || out.length >= text.length) return plain
  const lost = [...new Set(text.slice(0, 12_000).match(MUST_KEEP) ?? [])].filter(token => !out.includes(token.replace(/`/g, '')))
  if (kind === 'note' && lost.length > 0) return plain
  await update($, relayState, r => ({ ...r, count: r.count + 1, saved: r.saved + text.length - out.length }))
  return { text: out, relayed: true }
}

/** "Nav Bar", "UI: nav bar" or a group's name in any case reach the agent or group it means. */
const resolveRecipient = async ($: EngineInterface, to: string) => {
  const wanted = splitGroup(to).label.toLowerCase()
  const everyone = Object.values(await read($, agents))
  const names = ['orchestrator', 'you', ...everyone.map(a => a.label), ...everyone.map(a => a.group), ...Object.keys(await read($, groups))]
  return names.find(n => n.toLowerCase() === wanted) ?? names.find(n => n.toLowerCase().includes(wanted) || wanted.includes(n.toLowerCase())) ?? splitGroup(to).label
}

const postNote = async ($: EngineInterface, note: OrchestraNote) => {
  const relayed = note.relayed ? { text: note.text, relayed: true } : await relay($, note.text, 'note')
  const clean = { ...note, text: relayed.text.slice(0, 500), ...(relayed.relayed ? { relayed: true } : {}) }
  await update($, notes, list => [...list, clean].slice(-50))
  await logEvent($, { kind: 'note', ...clean })
  await writeBoardFile($).catch(() => {})
}

// The function, method or class a snippet of code defines or sits in, for "edits fetchMenu()".
const SYMBOL =
  /(?:function\*?\s+|def\s+|class\s+|interface\s+|type\s+|func\s+|fn\s+|(?:export\s+)?(?:const|let|var)\s+)([A-Za-z_$][\w$]*)|^\s*(?:(?:public|private|protected|static|async|override)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/m
const symbolOf = (code: unknown) => {
  if (typeof code !== 'string') return undefined
  const m = SYMBOL.exec(code)
  const name = m?.[1] ?? m?.[2]
  return name && !/^(if|for|while|switch|catch|return)$/.test(name) ? name : undefined
}

/** A read-only agent's role on a file: a reviewer audits, a planner plans, the rest read. */
const readRole = (a: OrchestraAgent | undefined): OrchestraTouch['role'] =>
  a === undefined ? 'reads' : /reviewer|review/i.test(`${a.type} ${a.label} ${a.group}`) ? 'audits' : /^(Plan|Explore)$|Planning|Research/.test(`${a.type}`) || a.group === 'Planning' ? 'plans' : 'reads'

/** Records how an agent touches a file; an edit outranks a read and keeps the last few symbols. */
const touch = ($: EngineInterface, path: string, agentId: string, role: OrchestraTouch['role'], symbol?: string) =>
  update($, touches, all => {
    const file = all[path] ?? {}
    const prev = file[agentId]
    const symbols = symbol && !prev?.symbols.includes(symbol) ? [...(prev?.symbols ?? []), symbol].slice(-4) : (prev?.symbols ?? [])
    const next = { ...all, [path]: { ...file, [agentId]: { role: prev?.role === 'edits' ? 'edits' : role, symbols } } }
    // The 80 most recently touched files are enough for the pane.
    const keys = Object.keys(next)
    return keys.length > 80 ? Object.fromEntries(keys.slice(-80).map(k => [k, next[k]!])) : next
  })

const READ_TOOLS: Record<string, string> = { Read: 'file_path', Grep: 'path', NotebookRead: 'notebook_path' }

const releaseClaims = ($: EngineInterface, id: string) =>
  update($, claims, all => Object.fromEntries(Object.entries(all).filter(([, c]) => c.agentId !== id)))

// --- External CLI agents ---------------------------------------------------

// Runs through a login shell so the CLIs resolve from the person's PATH even when the app started without it.
const viaShell = (argv: string[]) => ['/bin/zsh', '-lc', 'exec "$0" "$@"', ...argv]

/** "gpt-6.1-sol" → line "sol", version [6, 1]; ids without that shape are their own line. */
const lineOf = (id: string) => {
  const m = /^(.*?)-(\d+(?:\.\d+)*)-([a-z]+)$/.exec(id)
  return m ? { line: `${m[1]}-${m[3]}`, version: (m[2] ?? '').split('.').map(Number) } : { line: id, version: [] }
}
const newer = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}

/** Keeps the newest version of each model line, so gpt-5.6-sol and gpt-6-sol give way to gpt-6.1-sol. */
const newestPerLine = <M extends { id: string }>(models: M[]) =>
  models.filter(m => {
    const mine = lineOf(m.id)
    return !models.some(o => o !== m && lineOf(o.id).line === mine.line && newer(lineOf(o.id).version, mine.version))
  })

const loadCodexModels = async ($: EngineInterface): Promise<OrchestraModel[]> => {
  // `codex debug models` asks the CLI itself; models_cache.json is only what an older CLI last fetched.
  const { exitCode, stdout } = await $.process.run(
    ['/bin/zsh', '-lc', 'command -v codex >/dev/null && (codex debug models 2>/dev/null || cat "$HOME/.codex/models_cache.json")'],
    { timeoutMs: 30_000 },
  )
  if (exitCode !== 0) return []
  type Raw = { slug: string; description?: string; context_window?: number; visibility?: string; supported_reasoning_levels?: { effort: string }[] }
  const models = newestPerLine(((JSON.parse(stdout.slice(stdout.indexOf('{'))) as { models?: Raw[] }).models ?? []).filter(m => m.visibility === 'list').map(m => ({ ...m, id: m.slug })))
  return models.map(m => ({
    provider: 'codex' as const,
    id: m.slug,
    name: m.description ?? m.slug,
    window: m.context_window ?? 272_000,
    efforts: (m.supported_reasoning_levels ?? []).map(l => l.effort),
  }))
}

const parseAgyModels = (stdout: string): OrchestraModel[] =>
  stdout
    .split('\n')
    .map(line => line.split('\t').map(part => part.trim()))
    // Its Claude and GPT-OSS models stay: they spend the Antigravity quota, not this chat's Claude Code limits.
    .flatMap(([id, name, ...rest]) => (id && name && rest.length === 0 && /^[\w.-]+$/.test(id) ? [{ id, name }] : []))
    .map(({ id, name }) => ({
      provider: 'agy' as const,
      id,
      name,
      window: /gemini/i.test(id) ? 1_000_000 : 200_000,
      // Gemini ids carry their effort in the name; the rest take --effort.
      efforts: /-(low|medium|high)$/.test(id) ? [] : ['low', 'medium', 'high', 'xhigh', 'max'],
    }))

const loadAgyModels = async ($: EngineInterface): Promise<OrchestraModel[]> => {
  const { exitCode, stdout } = await $.process.run(viaShell(['agy', 'models']), { timeoutMs: 30_000 })
  return exitCode === 0 ? parseAgyModels(stdout) : []
}

// `opencode models` prints provider/model ids; Copilot's ones go through the copilot provider, which knows the plan.
const parseOpencodeModels = (stdout: string): OrchestraModel[] =>
  stdout
    .split('\n')
    .map(line => line.trim())
    .filter(id => /^[\w.-]+\/[\w.:-]+$/.test(id) && !id.startsWith('github-copilot/'))
    .map(id => ({
      provider: 'opencode' as const,
      id,
      name: (id.split('/')[1] ?? id).replace(/-free$/, ' (free)'),
      // shortcut: the CLI does not report windows; 200k is a floor most of them clear.
      window: 200_000,
      efforts: [],
    }))

const loadOpencodeModels = async ($: EngineInterface): Promise<OrchestraModel[]> => {
  const { exitCode, stdout } = await $.process.run(viaShell(['opencode', 'models']), { timeoutMs: 30_000 })
  return exitCode === 0 ? parseOpencodeModels(stdout) : []
}

// Copilot runs on auto: Copilot picks the model from what the plan allows, so auto is the one model offered.
const loadCopilotModels = async ($: EngineInterface): Promise<OrchestraModel[]> => {
  const { exitCode } = await $.process.run(viaShell(['copilot', '--version']), { timeoutMs: 30_000 })
  return exitCode === 0 ? [{ provider: 'copilot', id: 'auto', name: 'Copilot picks the model', window: 200_000, efforts: [] }] : []
}

// Kimi keeps its models in ~/.kimi-code/config.toml as [models."<alias>"] tables.
const parseKimiModels = (toml: string): OrchestraModel[] =>
  toml
    .split(/^\[models\."/m)
    .slice(1)
    .map(block => {
      const field = (key: string) => new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm').exec(block)?.[1]?.trim()
      const id = block.slice(0, block.indexOf('"'))
      return {
        provider: 'kimi' as const,
        id,
        name: field('display_name')?.replace(/^"|"$/g, '') ?? id,
        window: Number(field('max_context_size') ?? 262_144),
        // kimi -p has no effort flag; it runs at the effort its config sets.
        efforts: [],
      }
    })
    .filter(m => m.id !== '')

const loadKimiModels = async ($: EngineInterface): Promise<OrchestraModel[]> => {
  const { exitCode, stdout } = await $.process.run(
    ['/bin/zsh', '-lc', 'command -v kimi >/dev/null && cat "$HOME/.kimi-code/config.toml"'],
    { timeoutMs: 10_000 },
  )
  return exitCode === 0 ? parseKimiModels(stdout) : []
}

/** Copilot premium requests spent in the current calendar month, kept across sessions. */
type Premium = { month: string; used: number }
const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7)

const premiumUsed = async ($: EngineInterface) => {
  // The pane reads this on every draw; a store that cannot answer means nothing counted, not a blank pane.
  const p = (await $.store.get('copilotPremium').catch(() => undefined)) as Premium | undefined
  return p?.month === monthOf(await $.clock.now()) ? p.used : 0
}

const countPremium = async ($: EngineInterface, n: number) => {
  const month = monthOf(await $.clock.now())
  await $.store.set('copilotPremium', { month, used: (await premiumUsed($)) + n })
  $.ui.invalidate('ui.render')
}

/** Account refusals, by "provider" or "provider:model", kept across sessions until they lapse. */
type Blocks = Record<string, { reason: string; until: number }>

const applyBlocks = (models: OrchestraModel[], blocks: Blocks, now: number): OrchestraModel[] =>
  models.map(({ blocked: _, ...m }) => {
    // A lapsed model block must not hide a live block on its whole CLI.
    const b = [blocks[`${m.provider}:${m.id}`], blocks[m.provider]].find(x => x !== undefined && now < x.until)
    return b ? { ...m, blocked: b.reason } : m
  })

const readBlocks = async ($: EngineInterface) => ((await $.store.get('blocked')) as Blocks | undefined) ?? {}

// Every change to the block list waits its turn: parallel probes and failing runs would otherwise overwrite each other's read-modify-write.
let blocksQueue: Promise<unknown> = Promise.resolve()

const changeBlocks = ($: EngineInterface, change: (blocks: Blocks) => Blocks) => {
  const done = blocksQueue.then(async () => {
    const blocks = change(await readBlocks($))
    const now = await $.clock.now()
    await $.store.set('blocked', blocks)
    await update($, catalog, current => applyBlocks(current, blocks, now))
    await $.store.set('catalog', await read($, catalog))
  })
  blocksQueue = done.catch(() => {})
  return done
}

/** The catalog with its blocks checked again now, so a lapsed one frees its model within the session. */
const liveCatalog = async ($: EngineInterface) => applyBlocks(await read($, catalog), await readBlocks($), await $.clock.now())

// The line of a failed run that says the account refused it.
const REFUSAL = /not available|unavailable|no-route|subscription|auth_error|unauthori[sz]ed|forbidden|\b40[13]\b|not logged in|log ?in required|credits|exhausted|quota|rate.?limit/i
// Refusals that cover the whole account rather than the one model.
const ACCOUNT_WIDE = /subscription|auth_error|unauthori[sz]ed|\b401\b|not logged in|log ?in required/i
// Refusals that lift by themselves; the rest (plan, credits) last until the account changes or a probe sees the model answer.
const TRANSIENT = /rate.?limit|quota|service unavailable|\b50[23]\b/i

/** Marks the model, or the whole CLI when the refusal is account-wide, so routing stops offering it. */
const blockRefused = async ($: EngineInterface, provider: OrchestraExternal, model: string, text: string) => {
  const line = text.split(/\n|; /).find(l => REFUSAL.test(l))
  if (line === undefined) return undefined
  const wide = ACCOUNT_WIDE.test(line)
  // A refusal of the CLI's default model that says nothing about the account cannot tell which model to leave out.
  if (!wide && model === 'default') return undefined
  const until = (await $.clock.now()) + (TRANSIENT.test(line) ? 2 : 72) * 3_600_000
  const reason = oneLine(line.replace(/^(error:\s*)+/i, ''), 90)
  await changeBlocks($, blocks => ({ ...blocks, [wide ? provider : `${provider}:${model}`]: { reason, until } }))
  return wide ? ('provider' as const) : ('model' as const)
}

/** Another open model of the same CLI and tier for a refused one; none when the tier has no other (a clear failure beats a weaker model). */
const fallbackFor = (all: OrchestraModel[], provider: OrchestraExternal, refused: string) => {
  const open = all.filter(m => m.provider === provider && m.blocked === undefined && m.id !== refused)
  const tiers = (Object.keys(TIER_MATCH) as Tier[]).filter(t => TIER_MATCH[t].test(refused))
  return tiers.length > 0 ? open.find(m => tiers.some(t => TIER_MATCH[t].test(m.id))) : open[0]
}

const loadCatalog = async ($: EngineInterface) => {
  const none = (): OrchestraModel[] => []
  const fresh = (
    await Promise.all([
      loadCodexModels($).catch(none),
      loadAgyModels($).catch(none),
      loadOpencodeModels($).catch(none),
      loadCopilotModels($).catch(none),
      loadKimiModels($).catch(none),
    ])
  ).flat()
  // A CLI that answered nothing (offline, slow sign-in) keeps the models it listed last time.
  const previous = await read($, catalog)
  const kept = previous.filter(m => !fresh.some(f => f.provider === m.provider))
  const all = applyBlocks([...fresh, ...kept], await readBlocks($), await $.clock.now())
  await update($, catalog, () => all)
  await $.store.set('catalog', all)
}

type DelegateInput = {
  action?: 'start' | 'stop' | 'list' | 'probe'
  provider?: OrchestraExternal
  task?: string
  label?: string
  model?: string
  effort?: string
  fast?: boolean
  write?: boolean
  files?: string[]
  group?: string
  reportTo?: string
  review?: OrchestraProvider
  id?: string
  agentId?: string
  /** Set on the one retry after a refused model. */
  retried?: boolean
  /** The model the account refused before this retry. */
  retriedFrom?: string
}

const DIR = '.orchestra'
const BOARD_FILE = `${DIR}/BOARD.md`

// Reports and the board file live in the project; their own .gitignore keeps them out of commits.
const writeShared = async ($: EngineInterface, path: string, text: string) => {
  if (!(await $.fs.exists(`${DIR}/.gitignore`))) await $.fs.write(`${DIR}/.gitignore`, '*\n')
  await $.fs.write(path, text)
}

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13)

/** The board as a file the external CLIs can read again while they work. */
const writeBoardFile = async ($: EngineInterface) => {
  const all = Object.values(await read($, agents))
  if (!all.some(a => a.provider !== 'claude')) return
  const declared = await read($, groups)
  const line = (n: OrchestraNote) => `- **${n.from}**${n.to ? ` → **${n.to}**` : ''}: ${n.text.replace(/\n+/g, ' ')}`
  const names = [...new Set(all.map(a => a.group))]
  const text = `# Orchestra board

Written by the orchestra mod; read it again before editing a shared file and before you finish. To message someone, put "TO <name or group>: <message>" lines in your report.

## Groups
${names.map(name => `- **${name}**: ${goalOf(name, declared, all.filter(a => a.group === name)) ?? ''}`).join('\n') || '- none'}

## Agents
${all.map(a => `- ${a.isRunning ? 'running' : 'finished'} · **${a.label}** (${a.group}, ${PROVIDER_NAMES[a.provider]} ${short(a.model)}, effort ${a.effort}): ${oneLine(a.task, 120)} — now: ${a.doing}${a.report ? ` — report: ${a.report}` : ''}`).join('\n')}

## Claimed files (do not edit unless you hold them)
${Object.entries(await read($, claims)).map(([path, c]) => `- ${path}: ${c.label}`).join('\n') || '- none'}

## Notes
${(await read($, notes)).slice(-30).map(line).join('\n') || '- none'}
`
  await writeShared($, BOARD_FILE, text)
}

// shortcut: a stop is noticed on the child's next output; a silent child runs until it writes or exits.
const stopRequested = new Set<string>()

const effortInName = (model: string) => /-(low|medium|high)$/.exec(model)?.[1]

const argvFor = (input: DelegateInput, prompt: string, reportPath: string) => {
  const write = input.write !== false
  if (input.provider === 'codex') {
    return [
      'codex', 'exec', '--json', '--skip-git-repo-check',
      '-s', write ? 'workspace-write' : 'read-only',
      // The CLI itself saves the final message, so a report survives a read-only sandbox.
      '-o', reportPath,
      ...(input.model ? ['-m', input.model] : []),
      ...(input.effort ? ['-c', `model_reasoning_effort="${input.effort}"`] : []),
      ...(input.fast ? ['-c', 'service_tier="priority"'] : []),
      prompt,
    ]
  }
  if (input.provider === 'opencode') {
    // --auto approves what the agent allows; the plan agent denies edits, so read-only holds without a prompt.
    return [
      'opencode', 'run', '--format', 'json', '--auto',
      ...(write ? [] : ['--agent', 'plan']),
      ...(input.model ? ['-m', input.model] : []),
      prompt,
    ]
  }
  if (input.provider === 'copilot') {
    // Print mode needs every tool pre-approved; "write" denied keeps a read-only task from editing.
    // No --model and no effort: auto picks both, and refuses an effort.
    return ['copilot', '-p', prompt, '--output-format', 'json', '--allow-all-tools', '--disable-client-telemetry', ...(write ? [] : ['--deny-tool=write'])]
  }
  if (input.provider === 'kimi') {
    // shortcut: kimi -p refuses --auto, --yolo and --plan, so read-only rests on the prompt.
    return ['kimi', '-p', prompt, '--output-format', 'stream-json', ...(input.model ? ['-m', input.model] : [])]
  }
  // Print mode silently refuses any tool that asks for confirmation and ends the turn with no answer;
  // the sandbox keeps commands to the project (and temp), so approving them is bounded.
  // shortcut: agy read-only rests on the prompt (plan mode only drafts a plan), until agy has a read-only sandbox.
  return [
    'agy', '-p', prompt, '--output-format', 'stream-json',
    '--mode', 'accept-edits', '--sandbox', '--dangerously-skip-permissions',
    ...(input.model ? ['--model', input.model] : []),
    ...(input.effort && !effortInName(input.model ?? '') ? ['--effort', input.effort] : []),
  ]
}

/** What one line of a CLI's JSON stream tells the pane. */
type StreamFact = { doing?: string; edited?: string[]; read?: string[]; text?: string; finalText?: string; tokens?: number; model?: string; error?: string; premium?: number }

const WRITE_TOOL = /write|replace|edit|create|delete|move|rename|patch/i

// The file paths among a tool call's arguments.
const pathsIn = (params: Record<string, unknown>) =>
  Object.entries(params)
    .filter(([key, value]) => /file|path/i.test(key) && typeof value === 'string')
    .map(([, value]) => value as string)

const toolFact = (tool: string, params: Record<string, unknown>): StreamFact => {
  const paths = pathsIn(params)
  const kind = WRITE_TOOL.test(tool) ? 'edited' : 'read'
  return { doing: `${tool} ${paths.map(fileName).join(', ')}`.trim(), ...(paths.length > 0 ? { [kind]: paths } : {}) }
}

const readStreamLine = (provider: OrchestraExternal, line: string): StreamFact => {
  let ev: Record<string, any>
  try {
    ev = JSON.parse(line)
  } catch {
    return {}
  }
  if (provider === 'codex') {
    const item = ev.item ?? {}
    if (ev.type === 'turn.completed' && ev.usage) return { tokens: Number(ev.usage.input_tokens ?? 0) }
    if (ev.type === 'turn.failed' || ev.type === 'error') return { error: String(ev.error?.message ?? ev.message ?? 'failed') }
    if (item.type === 'command_execution') return { doing: `$ ${String(item.command ?? '').replace(/^\/bin\/\w+ -lc /, '')}` }
    if (item.type === 'file_change') {
      const paths = (item.changes ?? []).map((c: { path?: string }) => c.path).filter((p: unknown): p is string => typeof p === 'string')
      return { doing: `editing ${paths.map(fileName).join(', ')}`, edited: paths }
    }
    if (item.type === 'agent_message' && ev.type === 'item.completed') return { doing: `says: ${String(item.text ?? '')}`, finalText: String(item.text ?? '') }
    if (item.type && ev.type === 'item.started') return { doing: String(item.type).replace(/_/g, ' ') }
    return {}
  }
  if (provider === 'opencode') {
    const part = ev.part ?? {}
    if (ev.type === 'text' && typeof part.text === 'string') return { doing: `says: ${part.text}`, finalText: part.text }
    if (ev.type === 'tool_use') return toolFact(String(part.tool ?? 'tool'), part.state?.input ?? {})
    if (ev.type === 'step_finish' && part.tokens) return { tokens: Number(part.tokens.input ?? 0) + Number(part.tokens.cache?.read ?? 0) }
    if (ev.type === 'error') return { error: String(ev.error?.data?.message ?? ev.error?.message ?? ev.error?.name ?? 'failed') }
    return {}
  }
  if (provider === 'copilot') {
    const d = ev.data ?? {}
    if (ev.type === 'session.auto_mode_resolved') return { model: d.chosenModel }
    if (ev.type === 'assistant.message') return { model: d.model, ...(d.content ? { doing: `says: ${d.content}`, finalText: String(d.content) } : {}) }
    if (ev.type === 'tool.execution_start') return { doing: String(d.toolTitle ?? d.toolName ?? 'tool') }
    if (ev.type === 'tool.execution_complete') {
      const paths = (d.fileEdits ?? []).map((f: { path?: string }) => f.path).filter((p: unknown): p is string => typeof p === 'string')
      return paths.length > 0 ? { doing: `edited ${paths.map(fileName).join(', ')}`, edited: paths } : {}
    }
    if (ev.type === 'session.error' || ev.type === 'error') return { error: String(d.message ?? ev.message ?? 'failed') }
    if (ev.type === 'result') return { premium: Number(ev.usage?.premiumRequests ?? 0) }
    return {}
  }
  if (provider === 'kimi') {
    // shortcut: seen so far are {role, content} lines; tool calls are read as OpenAI-style tool_calls.
    if (ev.role !== 'assistant') return ev.type === 'error' ? { error: String(ev.message ?? 'failed') } : {}
    const call = ev.tool_calls?.[0]?.function
    if (call) {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(call.arguments ?? '{}')
      } catch {}
      return toolFact(String(call.name ?? 'tool'), args)
    }
    const text = typeof ev.content === 'string' ? ev.content : Array.isArray(ev.content) ? ev.content.map((c: { text?: string }) => c?.text ?? '').join('') : ''
    return text ? { doing: `says: ${text}`, finalText: text } : {}
  }
  if (ev.event === 'init') return { model: ev.init?.model }
  if (ev.event === 'result') {
    const r = ev.result ?? {}
    return { finalText: String(r.response ?? ''), ...(r.status && r.status !== 'SUCCESS' ? { error: String(r.error || r.status) } : {}) }
  }
  if (ev.event === 'error') return { error: String(ev.error?.message ?? ev.message ?? 'failed') }
  const step = ev.step_update
  if (step === undefined) return {}
  const fact: StreamFact = {}
  if (step.usage) fact.tokens = Number(step.usage.input_tokens ?? 0) + Number(step.usage.cache_read_tokens ?? 0)
  if (typeof step.text_delta === 'string') fact.text = step.text_delta
  if (step.tool_name && step.state === 'ACTIVE') Object.assign(fact, toolFact(step.tool_name, step.tool_info?.parameters ?? {}))
  return fact
}

/** Lines "TO <name>: <message>" in a report become board notes. */
const messagesIn = (report: string) =>
  [...report.matchAll(/^\s*TO\s+([^:\n]+):\s*(.+)$/gim)].map(m => ({ to: (m[1] ?? '').trim(), text: (m[2] ?? '').trim() }))

const externalPrompt = async ($: EngineInterface, input: DelegateInput, label: string, from: string, group: string, reportPath: string) => {
  const live = Object.values(await read($, agents)).filter(a => a.isRunning && a.label !== label)
  const held = Object.entries(await read($, claims))
  const allNotes = await read($, notes)
  const line = (n: OrchestraNote) => `${n.from}${n.to ? ` -> ${n.to}` : ''}: ${n.text}`
  const owned = input.files ?? []
  const goal = (await read($, groups))[group]
  return `You are "${label}", an external ${PROVIDER_NAMES[input.provider ?? 'codex']} agent in group "${group}"${goal ? ` (goal: ${goal})` : ''} on a team of coding agents working in this project at the same time.
Task from ${from}:
${input.task}

Files you own: ${owned.length > 0 ? owned.join(', ') : 'none named; change only what the task needs'}.
${input.write === false ? 'This is a read-only task: change no files.\n' : ''}Files other agents hold right now (do not edit them): ${held.filter(([, c]) => c.label !== label).map(([p, c]) => `${p} (${c.label})`).join(', ') || 'none'}.
Other agents running: ${live.map(a => `${a.label} [${PROVIDER_NAMES[a.provider]}] ${oneLine(a.task, 80)}`).join('; ') || 'none'}.
Notes for you: ${allNotes.filter(n => n.to === label || n.to === group).map(line).join(' | ') || 'none'}.
Recent board: ${allNotes.slice(-8).map(line).join(' | ') || 'empty'}.

Shared board file: ${BOARD_FILE} (who holds which file, notes, other agents' reports in ${DIR}/reports/). It is rewritten as the team works: read it before you start, before you edit a file another agent may touch, and again before you finish.

Your report is read by ${input.reportTo ?? from}${input.review ? ` and checked by a ${PROVIDER_NAMES[input.review]} reviewer` : ''}. ${
    // Only agy writes its own report; the others' final message is saved for them (read-only ones cannot write it).
    input.provider !== 'agy'
      ? `Your final message is saved as your report in ${reportPath}, so make that final message the complete report; do not write that file yourself.`
      : `Write your complete report to ${reportPath} before you finish (that file is yours to write${input.write === false ? ', the only one' : ''}), and end your reply with the same report.`
  }
Report format (Markdown):
## Summary
## Files changed
## How I checked it
## Left undone or risky
## Messages
One line per message, "TO <agent or group>: <message>"; they are posted to the board.${(await isLean($)) ? `\n\n${LEAN_AGENT}\nEach report section at most 3 lines.` : ''}`
}

const runExternal = async ($: EngineInterface, id: string, input: DelegateInput, label: string, from: string, prompt: string, reportPath: string) => {
  const provider = input.provider ?? 'codex'
  const trail: string[] = []
  let buffer = ''
  let streamed = ''
  let finalText = ''
  let error = ''
  let stderr = ''
  let ended: { code: number | null; signal: string | null } = { code: null, signal: null }
  const known = new Set(input.files ?? [])
  // OpenCode and Kimi report paths relative to the project; claims are absolute like the Claude agents' edits.
  const cwd = await $.session.cwd().catch(() => '')
  const absolute = (path: string) => (path.startsWith('/') || cwd === '' ? path : `${cwd.replace(/\/$/, '')}/${path.replace(/^\.\//, '')}`)

  const apply = async (fact: StreamFact) => {
    if (fact.text) streamed += fact.text
    if (fact.finalText) finalText = fact.finalText
    if (fact.error) error = fact.error
    const patch: Partial<OrchestraAgent> = {}
    if (fact.doing) {
      patch.doing = oneLine(fact.doing, 90)
      trail.push(oneLine(fact.doing, 160))
      if (trail.length > 40) trail.shift()
    }
    if (fact.tokens) patch.tokens = fact.tokens
    if (fact.model) patch.model = fact.model
    if (fact.premium) await countPremium($, fact.premium)
    if (Object.keys(patch).length > 0) await patchAgent($, id, patch)
    const me = (await read($, agents))[id]
    for (const path of (fact.read ?? []).map(absolute)) await touch($, path, id, input.write === false ? readRole(me) === 'reads' ? 'audits' : readRole(me) : readRole(me))
    for (const path of (fact.edited ?? []).map(absolute)) await touch($, path, id, 'edits')
    for (const path of (fact.edited ?? []).map(absolute)) {
      if (known.has(path)) continue
      known.add(path)
      // The CLI edits outside the guard; claiming what it touches warns the Claude agents off.
      await update($, claims, all => (all[path] ? all : { ...all, [path]: { agentId: id, label } }))
      await logEvent($, { kind: 'claim', from: label, text: `editing ${fileName(path)}` })
    }
  }

  try {
    const child = $.process.spawn({ argv: viaShell(argvFor(input, prompt, reportPath)) })
    const it = child[Symbol.asyncIterator]()
    for (;;) {
      const step = await it.next()
      if (step.done) {
        ended = step.value
        break
      }
      if (step.value.stream === 'stderr') {
        stderr = (stderr + step.value.text).slice(-2000)
      } else {
        buffer += step.value.text
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) if (line.trim()) await apply(readStreamLine(provider, line))
      }
      if (stopRequested.has(id)) {
        await it.return?.(undefined as never)
        error = 'stopped'
        break
      }
    }
    if (buffer.trim()) await apply(readStreamLine(provider, buffer))
  } catch (err) {
    error = `could not start ${provider}: ${String(err)}`
  }
  stopRequested.delete(id)

  // The file the agent (or the CLI) wrote wins; the streamed answer is the fallback.
  const written = (await $.fs.exists(reportPath).catch(() => false)) ? await $.fs.read(reportPath).catch(() => '') : ''
  const report = (typeof written === 'string' && written.trim() ? written : finalText || streamed).trim()
  const exitFailed = error !== '' || (ended.code !== null && ended.code !== 0)
  const failed = exitFailed || report === ''
  const why = exitFailed
    ? error || `exit ${ended.code}; ${oneLine(stderr.split('\n').filter(l => !/^\d{4}-\d\d-\d\dT/.test(l)).join(' '), 300)}`
    : report === ''
      ? `ended without a report (last step: ${trail.at(-1) ?? 'none'})`
      : ''
  const agent = (await read($, agents))[id]
  // A stop is the person's choice, not a refusal: it neither blocks the model nor retries.
  const refused =
    exitFailed && error !== 'stopped' ? await blockRefused($, provider, input.model ?? 'default', `${error}\n${stderr}`).catch(() => undefined) : undefined
  // A refused model gets one retry on another model of the same CLI and tier before anyone hears of it.
  const next = refused === 'model' && !input.retried ? fallbackFor(await liveCatalog($), provider, input.model ?? '') : undefined
  if (next !== undefined) {
    const { effort: _, ...rest } = input
    const keepEffort = input.effort !== undefined && next.efforts.includes(input.effort)
    const retry: DelegateInput = { ...rest, ...(keepEffort ? { effort: input.effort } : {}), model: next.id, retried: true, retriedFrom: input.model ?? 'default' }
    await patchAgent($, id, { model: next.id, effort: effortInName(next.id) ?? retry.effort ?? 'default', doing: `retrying on ${next.id}` })
    await logEvent($, { kind: 'note', from: label, text: `${input.model} refused by the account, retrying on ${next.id}` })
    // The first try's report file must not pass for the retry's.
    await writeShared($, reportPath, '').catch(() => {})
    return runExternal($, id, retry, label, from, prompt, reportPath)
  }
  const reader = input.reportTo?.trim() || from
  await writeShared(
    $,
    reportPath,
    `# ${label} — ${failed ? 'FAILED' : 'finished'}

- Agent: ${PROVIDER_NAMES[provider]} · ${agent?.model ?? input.model ?? 'default'} · effort ${agent?.effort ?? '-'}
- Group: ${agent?.group ?? GENERAL}
- Asked by: ${from} · report for: ${reader}${input.review ? ` · reviewed by: ${PROVIDER_NAMES[input.review]}` : ''}
${input.retriedFrom ? `- Retried: ${input.retriedFrom} was refused by the account, ran on ${input.model}\n` : ''}${failed ? `- Problem: ${why}\n` : ''}
## Task
${input.task}

${report || '(The agent left no report.)'}

## Activity
${trail.map(t => `- ${t}`).join('\n') || '- (none)'}
${exitFailed && stderr.trim() ? `\n## stderr (tail)\n\`\`\`\n${stderr.trim().slice(-1500)}\n\`\`\`\n` : ''}`,
  ).catch(() => {})

  const freed = Object.values(await read($, claims)).filter(c => c.agentId === id).length
  await patchAgent($, id, { isRunning: false, doing: failed ? `failed: ${oneLine(why, 80)}` : 'done', report: reportPath })
  for (const msg of messagesIn(report)) await postNote($, { from: label, to: await resolveRecipient($, msg.to), text: msg.text })
  const digest = report === '' ? { text: '', relayed: false } : await relay($, report, 'report')
  const summary = `${failed ? `FAILED (${why}). ` : ''}Report: ${reportPath}. ${digest.relayed ? digest.text : oneLine(report.replace(/^#+\s*/gm, ''), 300)}`
  await postNote($, { from: label, to: reader, text: summary, relayed: digest.relayed })
  if (reader !== from) await postNote($, { from: label, to: from, text: summary, relayed: digest.relayed })
  await logEvent($, {
    kind: 'done',
    from: label,
    to: reader,
    text: `${failed ? 'failed' : 'finished'}, report ${fileName(reportPath)}${freed > 0 ? `, released ${freed} file${freed === 1 ? '' : 's'}` : ''}`,
  })
  await releaseClaims($, id)

  // A second model reads the report: the reviewer the orchestrator asked for.
  let reviewLine = ''
  if (input.review && !failed) {
    const changed = input.files ?? []
    const task = `Review the work of agent "${label}" (${PROVIDER_NAMES[provider]}). Read its report at ${reportPath}${changed.length > 0 ? ` and the files it owned: ${changed.join(', ')}` : ' and the files it lists as changed'}. Check it against its task (in the report), run the project's tests or checks where they exist, and say whether it is correct. List concrete problems with file and line. Post the verdict to "${label}" and "${reader}".`
    if (input.review === 'claude') {
      reviewLine = await $.agent
        .spawn({ prompt: task, description: `${agent?.group ?? GENERAL}: review ${label}`, subagentType: 'orchestra:reviewer' })
        .then(() => '\nReview: started an orchestra:reviewer (Claude).')
        .catch(err => `\nReview: could not start an orchestra:reviewer (${String(err)}); start one yourself on ${reportPath}.`)
    } else {
      const started = await startExternal($, { provider: input.review, task, label: `review-${label}`, write: false, group: agent?.group, reportTo: reader })
      reviewLine = `\nReview: ${String(started.result)}`
    }
  }
  await writeBoardFile($).catch(() => {})
  await showStatus($)
  if (from === 'orchestrator') {
    await $.prompt.submit({
      text: `orchestra: external agent "${label}" (${PROVIDER_NAMES[provider]} ${agent?.model ?? ''}, effort ${agent?.effort ?? '-'}) ${failed ? `failed: ${why}` : 'finished'}${input.retriedFrom ? ` after ${input.retriedFrom} was refused` : ''}. Full report: ${reportPath}${reader !== from ? ` (addressed to ${reader})` : ''}.${reviewLine}\n\n${digest.relayed ? `Haiku digest (read the file for detail):\n${digest.text}` : report.slice(0, 4000) || '(no report)'}`,
    })
  }
}

/** Sends each model one tiny prompt and records which ones the account accepts. */
const probeModels = async ($: EngineInterface, only?: OrchestraExternal) => {
  await loadCatalog($)
  // Copilot's auto always answers; probing it would only spend a premium request.
  const targets = (await read($, catalog)).filter(m => (only === undefined || m.provider === only) && !(m.provider === 'copilot' && m.id === 'auto'))
  await writeShared($, `${DIR}/probe.txt`, '')
  const lines: string[] = []
  // ponytail: 4 at a time keeps CLIs that share one background service from starving; a full sweep takes a few minutes.
  for (let i = 0; i < targets.length; i += 4) {
    await Promise.all(
      targets.slice(i, i + 4).map(async m => {
        const ask: DelegateInput = { provider: m.provider, model: m.id, write: false, ...(m.efforts.includes('low') ? { effort: 'low' } : {}) }
        const run = await $.process
          .run(viaShell(argvFor(ask, 'Reply with exactly: OK', `${DIR}/probe.txt`)), { timeoutMs: 120_000 })
          .catch(err => ({ exitCode: 1, stdout: '', stderr: String(err) }))
        const error = run.stdout.split('\n').map(l => readStreamLine(m.provider, l).error).find(e => e !== undefined) ?? ''
        const name = `${m.provider}:${m.id}`
        if (run.exitCode === 0 && error === '') {
          await changeBlocks($, ({ [name]: _a, [m.provider]: _b, ...rest }) => rest)
          lines.push(`ok      ${name}`)
          return
        }
        const said = `${error}\n${run.stderr}`.split('\n').filter(l => l.trim())
        const refused = await blockRefused($, m.provider, m.id, said.join('\n'))
        lines.push(`${refused ? 'refused' : 'failed '} ${name}: ${oneLine(said.find(l => REFUSAL.test(l)) ?? said.at(-1) ?? `exit ${run.exitCode}`, 110)}`)
      }),
    )
  }
  return lines.sort().join('\n') || '(no models to probe)'
}

const startExternal = async ($: EngineInterface, input: DelegateInput) => {
  const provider = input.provider
  if (provider === undefined || !EXTERNAL.includes(provider)) return { result: `Error: provider must be one of ${EXTERNAL.map(p => `"${p}"`).join(', ')}.` }
  if (!input.task?.trim()) return { result: 'Error: task is required.' }
  const known = (await liveCatalog($)).filter(m => m.provider === provider)
  // Copilot is always auto; an OpenCode task with no model goes to the free DeepSeek one.
  if (provider === 'copilot') {
    const { effort: _, ...rest } = input
    input = { ...rest, model: 'auto' }
  } else if (provider === 'opencode' && !input.model) {
    const deepseek = known.find(m => m.blocked === undefined && /deepseek.*free/.test(m.id))
    if (deepseek) input = { ...input, model: deepseek.id }
  }
  if (known.length === 0) return { result: `Error: ${provider} is not installed or reported no models on this machine.` }
  const open = known.filter(m => m.blocked === undefined)
  if (open.length === 0) return { result: `Error: ${provider} is refusing this account right now (${known[0]?.blocked}). Use another provider.` }
  const picked = known.find(m => m.id === input.model)
  if (input.model && picked === undefined) {
    return { result: `Error: ${provider} has no model "${input.model}". Available: ${open.map(m => m.id).join(', ')}.` }
  }
  if (picked?.blocked !== undefined) {
    return { result: `Error: ${provider} model "${input.model}" was refused by this account (${picked.blocked}). Available: ${open.map(m => m.id).join(', ')}.` }
  }

  const live = await read($, agents)
  const from = input.agentId === undefined ? 'orchestrator' : (live[input.agentId]?.label ?? input.agentId)
  const taken = input.files ?? []
  const held = await read($, claims)
  const busy = taken.filter(path => live[held[path]?.agentId ?? '']?.isRunning)
  if (busy.length > 0) {
    return { result: `Not started: ${busy.map(p => `${p} is held by "${held[p]?.label}"`).join('; ')}. Pick other files or wait for that agent.` }
  }

  const n = Object.values(live).filter(a => a.provider === provider).length + 1
  const id = `${provider}-${n}`
  const label = input.label?.trim() || `${provider}-${n}`
  const group = input.group?.trim() || (input.agentId === undefined ? undefined : live[input.agentId]?.group) || autoGroup(provider, input.write !== false)
  const model = input.model ?? 'default'
  const takesEffort = TAKES_EFFORT.includes(provider) && !(provider === 'copilot' && (model === 'auto' || model === 'default'))
  const effort = effortInName(model) ?? (takesEffort ? (input.effort ?? 'default') : '-')
  const window = picked?.window ?? (provider === 'agy' ? 1_000_000 : provider === 'codex' ? 272_000 : 200_000)

  await update($, agents, all => ({
    ...all,
    [id]: { id, label, type: provider, group, provider, model, effort: input.fast ? `${effort} · fast` : effort, tokens: 0, window, task: oneLine(input.task ?? '', 160), from, doing: 'starting', isRunning: true },
  }))
  await update($, claims, all => ({ ...all, ...Object.fromEntries(taken.map(path => [path, { agentId: id, label }])) }))
  await logEvent($, { kind: 'spawn', from, to: label, text: `${PROVIDER_NAMES[provider]} · ${model} · ${oneLine(input.task ?? '', 80)}` })
  await showStatus($)

  const reportPath = `${DIR}/reports/${stamp(await $.clock.now())}-${id}.md`
  if (input.review && input.review !== 'claude' && !(await liveCatalog($)).some(m => m.provider === input.review && m.blocked === undefined)) {
    input = { ...input, review: 'claude' }
  }
  await writeBoardFile($).catch(() => {})
  const prompt = await externalPrompt($, input, label, from, group, reportPath)
  // Runs on after the tool answers; the module unloading kills the child.
  void runExternal($, id, input, label, from, prompt, reportPath).catch(async err => {
    // Whatever broke after the child, the agent must not stay "running" with its files held and nobody told.
    await patchAgent($, id, { isRunning: false, doing: `failed: ${oneLine(String(err), 80)}` })
    await releaseClaims($, id)
    await $.prompt.submit({ text: `orchestra: external agent "${label}" crashed in the mod: ${String(err)}` }).catch(() => {})
  })
  return {
    result: `Started ${PROVIDER_NAMES[provider]} agent "${label}" (id ${id}, model ${model}, effort ${effort}) in the background. Its report goes to ${reportPath} and to the board for ${input.reportTo ?? from}${from === 'orchestrator' ? ', and comes back to you as a message' : ''}${input.review ? `; a ${PROVIDER_NAMES[input.review]} reviewer checks it when it finishes` : ''}. Stop it with action "stop", id "${id}".`,
  }
}

// --- Hooks -----------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Lean rules ride in each role's prompt; a toggle reaches the roles at the next session.
    const lean = await isLean($)
    for (const role of ROLES) await $.agent.register(lean ? { ...role, prompt: `${role.prompt}\n\n${LEAN_AGENT}` } : role)
    await $.tool.register({
      name: 'board',
      description:
        'Shared board for the agents working on this project. action "read" lists who holds which file, notes addressed to you or your group, the groups and the latest notes; action "post" adds a note (text) every agent can read, addressed with "to" to one agent by name or to a whole group; action "group" sets what a group does (group, text).',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['read', 'post', 'group'] },
          text: { type: 'string', description: 'The note, or for "group" what the group does' },
          group: { type: 'string', description: 'For "group": the group name' },
          to: { type: 'string', description: 'Name of the agent the note is for, or "orchestrator"' },
        },
        required: ['action'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'delegate',
      description:
        'Run a task on an external CLI agent in the background: provider "codex" (OpenAI Codex CLI), "agy" (Google Antigravity CLI: Gemini, 1M context), "opencode" (OpenCode CLI: free models), "copilot" (GitHub Copilot CLI) or "kimi" (Kimi Code CLI). It shows in the orchestra pane with its model, effort and live activity, the files you give it are claimed for it, it sees the board, and its final report is posted to the board (and sent back to the orchestrator as a message). action "start" (default) needs provider, task and label; "stop" needs id; "list" shows the external agents; "probe" (optional provider) sends every model one tiny prompt and records which ones the account accepts.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['start', 'stop', 'list', 'probe'] },
          provider: { type: 'string', enum: EXTERNAL },
          task: { type: 'string', description: 'Full, self-contained instructions: the agent sees nothing of this conversation.' },
          label: { type: 'string', description: 'Short name for the pane and the board, e.g. "codex-review".' },
          model: { type: 'string', description: 'A model id from the orchestra routing list; omit for the CLI default.' },
          effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
          fast: { type: 'boolean', description: 'Codex only: priority tier, about 2x speed at higher usage.' },
          write: { type: 'boolean', description: 'false runs it read-only (review, survey, plan). Default true.' },
          files: { type: 'array', items: { type: 'string' }, description: 'Absolute paths it owns; claimed for it until it finishes.' },
          group: { type: 'string', description: 'The group it works in (set its goal with mcp__orchestra__board action "group"); default the caller\'s group.' },
          reportTo: { type: 'string', description: 'Agent or group that reads and acts on its report (a note with the report path is posted to it); default whoever called.' },
          review: { type: 'string', enum: PROVIDER_ORDER, description: 'When it finishes, a reviewer of this provider reads its report and checks the work. Pick a different provider than the author.' },
          id: { type: 'string', description: 'For "stop": the id "start" returned.' },
        },
      },
      isDeferred: false,
    })
    await $.command.register({ name: 'orchestra', description: 'Show the orchestra pane; "/orchestra lean on|off" toggles lean mode' })
    void $.ui.open({ id: PANE, title: 'Orchestra' })
    const { rateLimits } = await $.session.usage()
    await update($, limits, () => rateLimits)
    // The last session's model list answers at once; a fresh read replaces it in the background.
    const cached = (await $.store.get('catalog')) as OrchestraModel[] | undefined
    if (Array.isArray(cached) && cached.length > 0) {
      await update($, catalog, () => cached)
      void loadCatalog($).catch(() => {})
    } else {
      await loadCatalog($).catch(() => {})
    }
    // Keeps the reset countdowns current between measurements.
    $.clock.every(60_000, () => $.ui.invalidate('ui.render'))

    return next(e)
  })

  // A pane opened at session.start waits undrawn on a terminal under 144 columns; one opened while the person
  // submits a prompt counts as asked and is placed at any width. Closed by hand, it stays closed until /orchestra.
  on('prompt.submit', async ($, e, next) => {
    if ((await $.store.get('paneClosed').catch(() => undefined)) !== true) {
      const pane = (await $.ui.panes().catch(() => [])).find(p => p.id === PANE)
      if (pane === undefined || !pane.isPlaced) void $.ui.open({ id: PANE, title: 'Orchestra' }).catch(() => {})
    }
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await $.store.set('paneClosed', true).catch(() => {})
    return next(e)
  })

  on('command.run', { command: 'orchestra' }, async ($, e) => {
    const [word, value] = e.args.trim().toLowerCase().split(/\s+/)
    if (word === 'lean') {
      const isOn = value === 'on' ? true : value === 'off' ? false : !(await isLean($))
      await $.store.set('lean', isOn)
      $.ui.invalidate('ui.render')
      return { text: `Orchestra lean mode ${isOn ? 'on' : 'off'}: this chat and new external agents now; Claude subagent roles from the next session.` }
    }
    await $.store.set('paneClosed', false).catch(() => {})
    await $.ui.open({ id: PANE, title: 'Orchestra' })
    return { text: 'Orchestra pane opened. /orchestra lean [on|off] toggles lean mode.' }
  })


  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)
    const text = routing(await liveCatalog($), await premiumUsed($))
    const lean = (await isLean($)) ? [{ id: 'orchestra:lean', text: LEAN_ORCHESTRATOR, scope: 'session' as const }] : []
    return { sections: [...sections, { id: 'orchestra:routing', text, scope: 'session' as const }, ...lean] }
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await update($, limits, () => e.rateLimits)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.agentId !== undefined) {
      const id = started.agentId
      const live = await read($, agents)
      const from = e.parentAgentId === undefined ? 'orchestrator' : (live[e.parentAgentId]?.label ?? e.parentAgentId)
      const named = splitGroup(e.description)
      const label = named.label
      const group = named.group ?? (e.parentAgentId === undefined ? undefined : live[e.parentAgentId]?.group) ?? autoGroup(e.subagentType)
      const chat = await read($, main)
      await update($, agents, all => ({
        ...all,
        [id]: {
          id,
          label,
          type: e.subagentType,
          group,
          provider: 'claude' as const,
          model: started.model,
          effort: effortOf(e.subagentType),
          tokens: 0,
          window: windowOf(started.model, chat),
          task: oneLine(e.prompt, 160),
          from,
          doing: 'starting',
          isRunning: true,
        },
      }))
      await logEvent($, { kind: 'spawn', from, to: label, text: `${e.subagentType} · ${short(started.model)} · ${oneLine(e.prompt, 80)}` })
      await showStatus($)
    }
    return started
  })

  on('turn.step', async function* ($, e, next) {
    const step = yield* next(e)
    const effort = e.effort === undefined ? '-' : String(e.effort)
    if (e.agentId === undefined) {
      const { context } = await $.session.usage()
      await update($, main, () => ({ model: e.model, effort, tokens: context.tokens ?? 0, window: context.window }))
    } else if (step.usage !== null) {
      const u = step.usage
      const tokens = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      await patchAgent($, e.agentId, { model: e.model, effort, tokens, window: windowOf(e.model, await read($, main)), isRunning: true })
    }
    return step
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id !== undefined) {
      await patchAgent($, id, { isRunning: false, doing: e.isAborted ? 'stopped' : 'done' })
      const agent = (await read($, agents))[id]
      const freed = Object.values(await read($, claims)).filter(c => c.agentId === id).length
      await logEvent($, {
        kind: 'done',
        from: agent?.label ?? id,
        to: agent?.from ?? 'orchestrator',
        text: `${e.isAborted ? 'stopped' : 'finished'}${freed > 0 ? `, released ${freed} file${freed === 1 ? '' : 's'}` : ''}`,
      })
      await releaseClaims($, id)
      await showStatus($)
    }
    return next(e)
  })

  on('tool.call', { tool: 'mcp__orchestra__board' }, async ($, e) => {
    const input = e as unknown as { action?: string; text?: string; to?: string; group?: string; agentId?: string }
    const me = input.agentId === undefined ? undefined : (await read($, agents))[input.agentId]
    const label = input.agentId === undefined ? 'orchestrator' : (me?.label ?? input.agentId)
    if (input.action === 'group') {
      const name = input.group?.trim()
      if (!name || !input.text) return { result: 'Error: "group" needs group and text.' }
      await update($, groups, all => ({ ...all, [name]: input.text!.slice(0, 160) }))
      return { result: `Group "${name}" set.` }
    }
    if (input.action === 'post' && input.text) {
      // "UI: nav bar" and "nav bar" both reach that agent.
      const to = input.to === undefined ? undefined : await resolveRecipient($, input.to)
      await postNote($, { from: label, ...(to ? { to } : {}), text: input.text })
      return { result: 'Posted.' }
    }
    const all = await read($, notes)
    const line = (n: OrchestraNote) => `${n.from}${n.to ? ` → ${n.to}` : ''}: ${n.text}`
    const forMe = all.filter(n => n.to === label || (me !== undefined && n.to === me.group)).slice(-10).map(line)
    const everyone = Object.values(await read($, agents))
    const declared = await read($, groups)
    const goals = [...new Set([...Object.keys(declared), ...everyone.map(a => a.group)])].map(
      name => `${name}: ${goalOf(name, declared, everyone.filter(a => a.group === name)) ?? ''}`,
    )
    const held = Object.entries(await read($, claims)).map(([path, c]) => `${path}: ${c.label}`)
    const running = Object.values(await read($, agents))
      .filter(a => a.isRunning)
      .map(a => `${a.group} / ${a.label} [${PROVIDER_NAMES[a.provider]} ${short(a.model)}]: ${a.doing}`)
    return {
      result: `For you:\n${forMe.join('\n') || '(none)'}\n\nGroups:\n${goals.join('\n') || '(none)'}\n\nRunning agents:\n${running.join('\n') || '(none)'}\n\nClaimed files:\n${held.join('\n') || '(none)'}\n\nNotes:\n${all.slice(-15).map(line).join('\n') || '(none)'}`,
    }
  })

  on('tool.call', { tool: 'mcp__orchestra__delegate' }, async ($, e) => {
    const input = e as unknown as DelegateInput
    const action = input.action ?? 'start'
    if (action === 'stop') {
      const agent = input.id === undefined ? undefined : (await read($, agents))[input.id]
      if (agent === undefined || agent.provider === 'claude') return { result: `Error: no external agent with id "${input.id}".` }
      if (!agent.isRunning) return { result: `"${agent.label}" already finished.` }
      stopRequested.add(agent.id)
      await patchAgent($, agent.id, { doing: 'stopping' })
      return { result: `Stopping "${agent.label}"; it ends on its next output.` }
    }
    if (action === 'probe') return { result: await probeModels($, input.provider) }
    if (action === 'list') {
      const ext = Object.values(await read($, agents)).filter(a => a.provider !== 'claude')
      return {
        result: ext.map(a => `${a.id} "${a.label}" ${PROVIDER_NAMES[a.provider]} ${a.model} effort ${a.effort}: ${a.isRunning ? a.doing : 'finished'}`).join('\n') || '(none)',
      }
    }
    return startExternal($, input)
  })

  // No .catch: if the guard itself fails the edit goes through, so a mod bug never blocks work.
  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const me = e.agentId
    if (me !== undefined) await patchAgent($, me, { doing: describe(e.tool, input) })

    const readField = READ_TOOLS[String(e.tool)]
    const readPath = readField === undefined ? undefined : input[readField]
    // A Grep over a folder is not a document read; a path with an extension is.
    if (me !== undefined && typeof readPath === 'string' && /\.[\w]+$/.test(readPath)) {
      await touch($, readPath, me, readRole((await read($, agents))[me]))
    }

    const field = EDIT_TOOLS[String(e.tool)]
    const path = field === undefined ? undefined : input[field]
    if (typeof path !== 'string') return next(e)

    const live = await read($, agents)
    const owner = (all: Record<string, OrchestraClaim>) => {
      const held = all[path]
      return held !== undefined && held.agentId !== me && live[held.agentId]?.isRunning ? held : undefined
    }
    const myLabel = me === undefined ? 'orchestrator' : (live[me]?.label ?? me)
    if (me !== undefined) {
      // The orchestrator takes no claims; a subagent claims the file unless a live agent holds it.
      const wasMine = (await read($, claims))[path]?.agentId === me
      await update($, claims, all => (owner(all) ? all : { ...all, [path]: { agentId: me, label: myLabel } }))
      if (!wasMine && (await read($, claims))[path]?.agentId === me) {
        await logEvent($, { kind: 'claim', from: myLabel, text: `editing ${fileName(path)}` })
      }
    }
    const held = owner(await read($, claims))
    if (held === undefined && me !== undefined) {
      const edits = Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : [input]
      const symbols = e.tool === 'Write' ? ['whole file'] : edits.map(x => symbolOf(x.old_string) ?? symbolOf(x.new_string)).filter((x): x is string => x !== undefined)
      if (symbols.length === 0) await touch($, path, me, 'edits')
      for (const symbol of symbols) await touch($, path, me, 'edits', symbol)
    }
    if (held !== undefined) {
      await logEvent($, { kind: 'blocked', from: myLabel, to: held.label, text: `wants ${fileName(path)}, waits` })
      return {
        deny: `orchestra: ${path} is being edited by agent "${held.label}". Do not write it another way. Post to mcp__orchestra__board or wait until that agent finishes.`,
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    // The phone's table has no Input or Select: there the messaging part is read-only.
    const Input = 'Input' in ui ? ui.Input : undefined
    const Select = 'Select' in ui ? ui.Select : undefined
    const top = await read($, main)
    const agentsById = await read($, agents)
    const everyone = Object.values(agentsById)
    const running = everyone.filter(a => a.isRunning)
    const goals = await read($, groups)
    const held = Object.entries(await read($, claims))
    const files = await read($, touches)
    const feed = await read($, log)
    const allNotes = await read($, notes)
    const plan = await read($, limits)
    const premium = await premiumUsed($)
    const view = await read($, team)
    const relayNow = await read($, relayState)
    const lean = await isLean($)
    const now = await $.clock.now()
    const isOpen = (section: string) => (view.open ?? []).includes(section)
    const toggle = (section: string) =>
      void update($, team, v => ({ ...v, open: isOpen(section) ? (v.open ?? []).filter(x => x !== section) : [...(v.open ?? []), section] }))
    const setView = (patch: Partial<OrchestraTeamView>) => update($, team, v => ({ ...v, ...patch }))
    const byLabel = (label: string) => everyone.find(a => a.label === label)
    const tag = (label: string) => {
      const a = byLabel(label)
      return a ? `${label} (${PROVIDER_NAMES[a.provider]})` : label
    }
    const pct = (used: number, total: number) => `${Math.round((used / Math.max(1, total)) * 100)}%`
    const PROVIDER_COLOR: Record<OrchestraProvider, string> = { claude: 'magenta', codex: 'blue', agy: 'yellow', opencode: 'green', copilot: 'white', kimi: 'red' }
    const ROLE_ICON: Record<OrchestraTouch['role'], string> = { edits: '✎', audits: '◉', reads: '◎', plans: '◇' }

    const card = (title: string, hint: string | undefined, ...body: RenderChildren[]) => (
      <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} marginBottom={1}>
        <Text>
          <Text bold color="cyan">
            {title}
          </Text>
          {hint !== undefined && <Text dimColor> · {hint}</Text>}
        </Text>
        {body}
      </Box>
    )
    // A header that opens and shuts its section; in the terminal its digit does too while the pane has the focus.
    const fold = (section: string, hotkey: string | undefined, title: RenderChildren, summary: string) => (
      <Button key={`fold-${section}`} plain {...(hotkey ? { hotkey } : {})} onPress={() => toggle(section)}>
        <Text bold>
          {isOpen(section) ? '▾' : '▸'} {title}
        </Text>
        <Text dimColor> {summary}</Text>
      </Button>
    )

    // --- Usage: always on top -------------------------------------------------
    const limitRow = (l: OrchestraLimit) => {
      const used = Math.min(100, l.percentUsed)
      const color = used >= 90 ? 'red' : used >= 70 ? 'yellow' : 'green'
      return (
        <Text>
          {(LIMIT_NAMES[l.kind] ?? l.kind).padEnd(5)} <Text color={color}>{bar(used, 100)}</Text> {Math.round(used)}% used · {Math.round(100 - used)}% left
          <Text dimColor>{resetLabel(l.resetsAt, now)}</Text>
        </Text>
      )
    }

    // --- Agents, by provider ----------------------------------------------------
    const filesOf = (id: string, edits: boolean) =>
      Object.entries(files)
        .filter(([, by]) => by[id] !== undefined && (by[id]!.role === 'edits') === edits)
        .map(([path, by]) => `${fileName(path)}${by[id]!.symbols.length > 0 ? ` (${by[id]!.symbols.join(', ')})` : ''}`)
    const peers = (label: string) => {
      const seen: string[] = []
      for (const n of [...allNotes].reverse()) {
        const other = n.from === label ? n.to : n.to === label ? n.from : undefined
        if (other !== undefined && !seen.includes(other)) seen.push(other)
        if (seen.length === 3) break
      }
      return seen
    }
    const agentRow = (a: OrchestraAgent) => {
      // Claims cover what a CLI edited before the pane saw how; touches add the functions and the reads.
      const edits = filesOf(a.id, true)
      const claimed = held.filter(([path, c]) => c.agentId === a.id && !edits.some(x => x.startsWith(fileName(path)))).map(([path]) => fileName(path))
      const editing = [...edits, ...claimed]
      const reading = filesOf(a.id, false)
      const role = readRole(a)
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            <Text color={a.isRunning ? 'green' : undefined} dimColor={!a.isRunning}>
              {a.isRunning ? '●' : '○'}
            </Text>{' '}
            <Text bold>{a.label}</Text>
            <Text dimColor>
              {' '}
              {a.group} · {a.type}
            </Text>
          </Text>
          <Text dimColor>
            {'  '}
            {short(a.model)} · effort {a.effort} · ctx {bar(a.tokens, a.window)} {kTokens(a.tokens)}/{kTokens(a.window)} {pct(a.tokens, a.window)}
          </Text>
          <Text dimColor>
            {'  '}task from {a.from}: {oneLine(a.task, 110)}
          </Text>
          <Text dimColor>
            {'  '}now: {a.doing}
          </Text>
          {a.isRunning && editing.length > 0 && (
            <Text color="cyan">
              {'  '}✎ edits {editing.join(', ')}
            </Text>
          )}
          {a.isRunning && reading.length > 0 && (
            <Text dimColor>
              {'  '}
              {ROLE_ICON[role]} {role} {reading.slice(-4).join(', ')}
            </Text>
          )}
          {a.report !== undefined && (
            <Text dimColor>
              {'  '}▤ report: {a.report}
            </Text>
          )}
          {peers(a.label).length > 0 && (
            <Text color="cyan">
              {'  '}↔ {peers(a.label).join(', ')}
            </Text>
          )}
        </Box>
      )
    }
    const providerBlock = (provider: OrchestraProvider, index: number) => {
      const mine = everyone.filter(a => (a.provider ?? 'claude') === provider)
      if (mine.length === 0) return null
      const live = mine.filter(a => a.isRunning)
      const shown = [...live, ...mine.filter(a => !a.isRunning).slice(-5)]
      const summary = `· ${live.length} running · ${mine.length - live.length} done${live.length > 0 ? ` · ${live.map(a => a.label).join(', ')}` : ''}`
      return (
        <Box flexDirection="column">
          {fold(provider, String(index + 1), <Text color={PROVIDER_COLOR[provider]}>{PROVIDER_NAMES[provider]}</Text>, oneLine(summary, 90))}
          {isOpen(provider) && <Box flexDirection="column" paddingLeft={2}>{shown.map(agentRow)}</Box>}
        </Box>
      )
    }
    const groupNames = [...new Set(everyone.map(a => a.group ?? GENERAL))]

    // --- Files: who does what on each file ------------------------------------
    const liveFiles = Object.entries(files)
      .map(([path, by]) => [path, Object.entries(by).filter(([id]) => (agentsById[id]?.isRunning ?? false))] as const)
      .filter(([, by]) => by.length > 0)
      .sort((x, y) => y[1].length - x[1].length)
      .slice(0, 10)

    // --- Working together ---------------------------------------------------------
    const pairs = new Map<string, { a: string; b: string; count: number; last: OrchestraNote }>()
    for (const n of allNotes) {
      if (n.to === undefined || n.to === n.from) continue
      const [a, b] = [n.from, n.to].sort() as [string, string]
      const key = `${a}\u0000${b}`
      pairs.set(key, { a, b, count: (pairs.get(key)?.count ?? 0) + 1, last: n })
    }
    const links = [...pairs.values()].sort((x, y) => y.count - x.count).slice(0, 8)
    const waits = feed.filter(ev => ev.kind === 'blocked' && byLabel(ev.from)?.isRunning && ev.to !== undefined && byLabel(ev.to)?.isRunning).slice(-5)
    const ICON: Record<OrchestraEvent['kind'], string> = { spawn: '⇢', claim: '✎', blocked: '⏸', note: '✉', done: '✓' }
    const COLOR: Partial<Record<OrchestraEvent['kind'], string>> = { blocked: 'yellow', done: 'green', note: 'cyan' }
    const eventRow = (ev: OrchestraEvent) => (
      <Text>
        <Text color={COLOR[ev.kind]}>{ICON[ev.kind]}</Text> <Text bold>{ev.from}</Text>
        {ev.to !== undefined && <Text dimColor> → </Text>}
        {ev.to !== undefined && <Text bold>{ev.to}</Text>}
        <Text dimColor>: {ev.text.slice(0, 90)}</Text>
        {ev.relayed && <Text color="magenta"> ⚡haiku</Text>}
      </Text>
    )
    const noteRow = (n: OrchestraNote) => (
      <Text>
        <Text bold>{n.from}</Text>
        {n.to !== undefined && <Text dimColor> → </Text>}
        {n.to !== undefined && <Text bold>{n.to}</Text>}
        <Text dimColor>: {oneLine(n.text, 160)}</Text>
        {n.relayed && <Text color="magenta"> ⚡</Text>}
      </Text>
    )

    // --- One agent up close, and the composer --------------------------------------
    const picked = everyone.find(a => a.id === view.selected) ?? running.at(-1) ?? everyone.at(-1)
    const thread = picked === undefined ? [] : allNotes.filter(n => n.from === picked.label || n.to === picked.label || n.to === picked.group).slice(-8)
    const recipients = [...new Set([...running.map(a => a.label), ...everyone.map(a => a.group), 'orchestrator'])]
    const to = recipients.includes(view.to) ? view.to : (picked?.label ?? 'orchestrator')

    return (
      <Box flexDirection="column">
        {card(
          'Usage',
          'live',
          plan.length === 0 ? <Text dimColor>No reading yet (shows after the first reply on a subscription).</Text> : plan.map(limitRow),
          top === null ? (
            <Text dimColor>Chat  no request yet</Text>
          ) : (
            <Text>
              Chat {'  '}
              <Text color={top.tokens / Math.max(1, top.window) >= 0.8 ? 'yellow' : 'cyan'}>{bar(top.tokens, top.window)}</Text> {kTokens(top.tokens)}/
              {kTokens(top.window)} ({pct(top.tokens, top.window)})<Text dimColor> · {short(top.model)} · effort {top.effort}</Text>
            </Text>
          ),
          premium > 0 && (
            <Text dimColor>
              Copilot {premium} premium request{premium === 1 ? '' : 's'} this month
            </Text>
          ),
        )}
        {card(
          'Orchestra',
          `${lean ? 'lean · ' : ''}${running.length} running${PROVIDER_ORDER.map(p => {
            const count = running.filter(a => (a.provider ?? 'claude') === p).length
            return count > 0 ? ` · ${PROVIDER_NAMES[p]} ${count}` : ''
          }).join('')}`,
          everyone.length === 0 && <Text dimColor>No agents yet.</Text>,
          groupNames.map(name => {
            const members = everyone.filter(a => (a.group ?? GENERAL) === name)
            return (
              <Text>
                <Text color="cyan">▣ {name}</Text>
                <Text dimColor>
                  {' '}
                  ({members.length} agent{members.length === 1 ? '' : 's'}, {members.filter(a => a.isRunning).length} running) {goalOf(name, goals, members) ?? ''}
                </Text>
              </Text>
            )
          }),
          PROVIDER_ORDER.map(providerBlock),
        )}
        {card(
          '▤ Files',
          liveFiles.length === 0 ? 'nobody on a file' : `${liveFiles.length} in use`,
          liveFiles.map(([path, by]) => (
            <Box flexDirection="column">
              <Text>
                <Text bold>{fileName(path)}</Text>
                {by.length > 1 && <Text color="yellow"> · {by.length} agents</Text>}
              </Text>
              {by.map(([id, t]) => (
                <Text color={t.role === 'edits' ? 'cyan' : undefined} dimColor={t.role !== 'edits'}>
                  {'  '}
                  {ROLE_ICON[t.role]} {tag(agentsById[id]?.label ?? id)} {t.role}
                  {t.symbols.length > 0 ? ` · ${t.symbols.map(x => (x === 'whole file' ? x : `${x}()`)).join(', ')}` : ''}
                </Text>
              ))}
            </Box>
          )),
        )}
        {card(
          '⇄ Working together',
          waits.length > 0 ? `${waits.length} waiting` : undefined,
          links.length === 0 && <Text dimColor>No messages between agents yet.</Text>,
          links.map(l => (
            <Text>
              <Text bold>{tag(l.a)}</Text>
              <Text color="cyan"> ⇄ </Text>
              <Text bold>{tag(l.b)}</Text>
              <Text dimColor>
                {' '}· {l.count} msg{l.count === 1 ? '' : 's'} · last {l.last.from}: {oneLine(l.last.text, 60)}
              </Text>
            </Text>
          )),
          waits.map(w => (
            <Text color="yellow">
              ⏸ {w.from} waits on {w.to}: {w.text}
            </Text>
          )),
          feed.length > 0 && fold('activity', 'a', 'Activity', `· last ${Math.min(14, feed.length)}`),
          isOpen('activity') && feed.slice(-14).map(eventRow),
        )}
        {card(
          '● Agent',
          picked === undefined ? undefined : picked.isRunning ? 'running' : 'finished',
          everyone.length === 0 && <Text dimColor>No agents yet.</Text>,
          Select !== undefined && everyone.length > 0 && (
            <Select
              key="team-agent"
              label="Show"
              value={picked?.id ?? ''}
              options={[...everyone].reverse().map(a => ({ value: a.id, label: `${a.isRunning ? '● ' : '○ '}${a.group} / ${a.label} · ${PROVIDER_NAMES[a.provider]}` }))}
              onSelect={value => void setView({ selected: value })}
            />
          ),
          picked !== undefined && (
            <Box flexDirection="column" marginTop={1}>
              {agentRow(picked)}
              <Text> </Text>
              {thread.length === 0 ? <Text dimColor>No messages to or from it.</Text> : thread.map(noteRow)}
              <Box flexDirection="row" gap={1} marginTop={1}>
                <Button
                  key="team-status"
                  label="Ask for status"
                  onPress={() => void postNote($, { from: 'you', to: picked.label, text: 'Post a one-line status on the board: done, doing, blocked on.' })}
                />
                {picked.isRunning && picked.provider !== 'claude' && (
                  <Button
                    key="team-stop"
                    label="Stop"
                    onPress={() => {
                      stopRequested.add(picked.id)
                      void patchAgent($, picked.id, { doing: 'stopping' })
                    }}
                  />
                )}
              </Box>
            </Box>
          ),
        )}
        {card(
          '✉ Message the team',
          'read on the board',
          Select !== undefined && (
            <Select key="team-to" label="To" value={to} options={recipients.map(r => ({ value: r, label: r }))} onSelect={value => void setView({ to: value })} />
          ),
          Input !== undefined && (
            <Input
              key="team-message"
              placeholder="Write a message…"
              submitLabel="Send"
              onSubmit={text => {
                if (text.trim()) void postNote($, { from: 'you', to, text: text.trim() })
              }}
            />
          ),
          Input === undefined && <Text dimColor>Open this pane on the computer to send messages.</Text>,
        )}
        {card(
          '⚡ Haiku relay',
          undefined,
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Text>
              <Text bold color={relayNow.isOn ? 'green' : undefined} dimColor={!relayNow.isOn}>
                {relayNow.isOn ? 'ON' : 'OFF'}
              </Text>
              <Text dimColor>
                {' '}
                · {relayNow.count} condensed · ~{Math.round(relayNow.saved / 4)} tokens saved
              </Text>
            </Text>
            <Button key="team-relay" label={relayNow.isOn ? 'Turn off' : 'Turn on'} onPress={() => void update($, relayState, r => ({ ...r, isOn: !r.isOn }))} />
          </Box>,
        )}
      </Box>
    )
  })
}
