export type OrchestraMain = {
  model: string
  effort: string
  tokens: number
  window: number
}

/** Where an agent runs: a Claude subagent or one of the external CLIs (Codex, Antigravity, OpenCode, Copilot, Kimi). */
export type OrchestraProvider = 'claude' | 'codex' | 'agy' | 'opencode' | 'copilot' | 'kimi'

export type OrchestraExternal = Exclude<OrchestraProvider, 'claude'>

export type OrchestraAgent = {
  id: string
  label: string
  type: string
  /** The team it belongs to; agents of a group share one goal. */
  group: string
  provider: OrchestraProvider
  model: string
  effort: string
  tokens: number
  window: number
  /** What it was asked to do, shortened. */
  task: string
  /** Who handed it the task. */
  from: string
  doing: string
  isRunning: boolean
  /** The Markdown report an external agent left, relative to the project. */
  report?: string
}

export type OrchestraClaim = { agentId: string; label: string }

/** relayed: Haiku condensed it before it reached the board. */
export type OrchestraNote = { from: string; to?: string; text: string; relayed?: boolean }

/** How an agent touches a file: edits it, audits (reviews) it, reads it, or reads it to plan; symbols are the functions or classes its edits hit. */
export type OrchestraTouch = { role: 'edits' | 'audits' | 'reads' | 'plans'; symbols: string[] }

/** What the pane has picked: the agent it details, where its composer sends, and the sections expanded. */
export type OrchestraTeamView = { selected: string; to: string; open?: string[] }

/** The Haiku relay: on or off, and what it has saved so far. */
export type OrchestraRelay = { isOn: boolean; count: number; saved: number }

/** One line of the activity feed: who handed what to whom, who took or waits on which file. */
export type OrchestraEvent = {
  kind: 'spawn' | 'claim' | 'blocked' | 'note' | 'done'
  from: string
  to?: string
  text: string
  relayed?: boolean
}

export type OrchestraLimit = { kind: string; percentUsed: number; resetsAt?: string }

/** A model an external CLI offers on this machine, read when the session starts. */
export type OrchestraModel = {
  provider: OrchestraExternal
  id: string
  name: string
  window: number
  efforts: string[]
  /** Why the account refused it on a recent run (plan, quota, sign-in); routing skips it until the block expires. */
  blocked?: string
}

declare module 'claude-code' {
  interface PluginState {
    orchestra: {
      main: OrchestraMain | null
      agents: Record<string, OrchestraAgent>
      claims: Record<string, OrchestraClaim>
      notes: OrchestraNote[]
      limits: OrchestraLimit[]
      log: OrchestraEvent[]
      catalog: OrchestraModel[]
      /** Each group's goal, by group name. */
      groups: Record<string, string>
      team: OrchestraTeamView
      /** By file path, then agent id. */
      touches: Record<string, Record<string, OrchestraTouch>>
      relay: OrchestraRelay
    }
  }
}
