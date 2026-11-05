import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'orchestra',
  props: { title: 'Orchestra', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 } },
} as const

const FOLDS: Record<string, string> = { claude: 'Claude', codex: 'Codex', agy: 'Gemini (AGY)', opencode: 'OpenCode', copilot: 'Copilot', kimi: 'Kimi', activity: 'Activity' }
const esc = (text: string) => text.replace(/[()]/g, '\\$&')

/** Opens every folded provider (and Activity) the pane shows; an open one stays open. */
const expandAll = async (ui: any) => {
  for (const [key, title] of Object.entries(FOLDS)) {
    if (await ui.find({ type: 'Text', text: new RegExp(`^▸ ${esc(title)}`) })) await ui.press({ key: `fold-${key}` })
  }
}

test('a spawned agent and a board note show in the pane on every surface', async ($, on) => {
  mock.clock(on, { now: Date.parse('2099-01-01T08:00:00Z') })
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  await $.agent.spawn({ prompt: 'Make the buttons', description: 'buttons', subagentType: 'orchestra:builder' })

  await $.tool.call({ tool: 'mcp__orchestra__board', action: 'post', text: 'nav.html is mine' })
  const board = await $.tool.call({ tool: 'mcp__orchestra__board', action: 'read' })
  expect(String(board.result)).toContain('nav.html is mine')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'orchestra', surface, ...PANE })
    await expandAll(ui)
    expect(await ui.find({ type: 'Text', text: /buttons/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /effort medium/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the pane shows what is left of the 5-hour and weekly limits and when they reset', async ($, on) => {
  mock.clock(on, { now: Date.parse('2099-01-01T08:00:00Z') })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 23.5, resetsAt: '2099-01-01T12:00:00Z' },
      { kind: 'seven_day', percentUsed: 92, resetsAt: '2099-01-05T12:00:00Z' },
    ],
    changed: ['rateLimits'],
  })
  const ui = await $.ui.mount({ plugin: 'orchestra', surface: 'desktop', ...PANE })
  await expandAll(ui)
  expect(await ui.find({ type: 'Text', text: /5h .*77% left/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Week .*8% left/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /resets .*\(in \d+d/ })).toBeDefined()
  await ui.unmount()
})

test('the pane shows the hand-offs, the file each agent edits and who waits on whom', async ($, on) => {
  mock.clock(on, { now: 0 })
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `a${++n}` }))
  on('tool.call', () => ({ result: 'ok' }))
  await $.agent.spawn({ prompt: 'nav', description: 'nav', subagentType: 'orchestra:builder' })
  await $.agent.spawn({ prompt: 'footer', description: 'footer', subagentType: 'orchestra:builder' })

  await $.tool.call({ tool: 'Edit', file_path: '/p/src/nav.tsx', agentId: 'a1' })
  const refused = await $.tool.call({ tool: 'Edit', file_path: '/p/src/nav.tsx', agentId: 'a2' })
  expect(String(refused.text ?? refused.deny ?? '')).toContain('nav')
  await $.tool.call({ tool: 'mcp__orchestra__board', action: 'post', to: 'nav', text: 'add the footer link', agentId: 'a2' })
  const board = await $.tool.call({ tool: 'mcp__orchestra__board', action: 'read', agentId: 'a1' })
  expect(String(board.result)).toContain('For you:\nfooter → nav: add the footer link')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'orchestra', surface, ...PANE })
    await expandAll(ui)
    expect(await ui.find({ type: 'Text', text: /✎ edits src\/nav\.tsx/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /footer → nav: wants src\/nav\.tsx/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /footer → nav: add the footer link/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /orchestrator → nav/ })).toBeDefined()
    await ui.unmount()
  }
})

const CODEX_CACHE = JSON.stringify({
  models: [
    { slug: 'gpt-6.1-sol', description: 'Workhorse', context_window: 500000, visibility: 'list', supported_reasoning_levels: [{ effort: 'medium' }, { effort: 'high' }] },
    { slug: 'hidden', visibility: 'hide' },
  ],
})

const CODEX_STREAM = [
  { type: 'turn.started' },
  { type: 'item.started', item: { type: 'command_execution', command: "/bin/zsh -lc 'npm test'" } },
  { type: 'item.completed', item: { type: 'file_change', changes: [{ path: '/p/src/api.ts', kind: 'update' }] } },
  { type: 'item.completed', item: { type: 'agent_message', text: 'Changed src/api.ts.\nTO nav: api.ts now exports fetchMenu' } },
  { type: 'turn.completed', usage: { input_tokens: 42000 } },
]
  .map(l => JSON.stringify(l))
  .join('\n')

test('an external Codex agent runs in the background, shows in the pane, claims what it edits and reports on the board', async ($, on) => {
  mock.clock(on, { now: 0 })
  mock.store(on)
  on('process.run', (_$, e) => ({ value: {
    exitCode: e.argv.join(' ').includes('codex') ? 0 : 1,
    stdout: e.argv.join(' ').includes('codex') ? CODEX_CACHE : '',
    stderr: '',
    isStdoutTruncated: false,
    isStderrTruncated: false,
  } }) as never)
  let argv: readonly string[] = []
  let release = () => {}
  const gate = new Promise<void>(resolve => (release = resolve))
  on('process.spawn', async function* (_$, e) {
    argv = e.argv
    yield { stream: 'stdout' as const, text: CODEX_STREAM.slice(0, 150) }
    await gate
    yield { stream: 'stdout' as const, text: `${CODEX_STREAM.slice(150)}\n` }
    return { value: { code: 0, signal: null } } as never
  })
  const submitted: string[] = []
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text } as never
  })
  for (const name of ['agent.register', 'tool.register', 'command.register'] as const) on(name, () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.usage', () => ({ value: { rateLimits: [], context: { window: 200_000 } } }) as never)
  on('session.start', () => ({ cwd: '/p' }) as never)
  await $.session.start({ source: 'startup', cwd: '/p' } as never)

  const unknown = await $.tool.call({ tool: 'mcp__orchestra__delegate', provider: 'agy', task: 'x', label: 'g' })
  expect(String(unknown.result)).toContain('not installed')

  const started = await $.tool.call({
    tool: 'mcp__orchestra__delegate',
    provider: 'codex',
    model: 'gpt-6.1-sol',
    effort: 'high',
    fast: true,
    label: 'codex-api',
    task: 'Add fetchMenu to src/api.ts',
    files: ['/p/src/api.ts'],
  })
  expect(String(started.result)).toContain('Started Codex agent "codex-api"')
  expect(argv.join(' ')).toContain('model_reasoning_effort="high"')
  expect(argv.join(' ')).toContain('service_tier="priority"')

  const ui = await $.ui.mount({ plugin: 'orchestra', surface: 'desktop', ...PANE })

  await expandAll(ui)
  expect(await ui.find({ type: 'Text', text: /1 running · Codex 1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /● codex-api/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /gpt-6\.1-sol · effort high · fast/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /task from orchestrator: Add fetchMenu/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✎ edits src\/api\.ts/ })).toBeDefined()
  await ui.unmount()

  const refused = await $.tool.call({ tool: 'Edit', file_path: '/p/src/api.ts', agentId: 'claude-1' })
  expect(String(refused.deny ?? '')).toContain('codex-api')

  release()
  await new Promise(resolve => setTimeout(resolve, 50))
  const board = await $.tool.call({ tool: 'mcp__orchestra__board', action: 'read' })
  expect(String(board.result)).toContain('codex-api → nav: api.ts now exports fetchMenu')
  expect(String(board.result)).toMatch(/codex-api → orchestrator: Report: \.orchestra\/reports\/[\d-]+-codex-1\.md\. Changed src\/api\.ts\./)
  expect(argv.join(' ')).toMatch(/-o \.orchestra\/reports\/[\d-]+-codex-1\.md/)
  expect(submitted.join('\n')).toContain('external agent "codex-api"')
  const after = await $.ui.mount({ plugin: 'orchestra', surface: 'terminal', ...PANE })
  await expandAll(after)
  expect(await after.find({ type: 'Text', text: /↔ orchestrator, nav/ })).toBeDefined()
  await after.unmount()
})

test('an Antigravity (Gemini) agent streams its tool steps into the pane and its answer onto the board', async ($, on) => {
  mock.clock(on, { now: 0 })
  mock.store(on, {
    catalog: [{ provider: 'agy', id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)', window: 1_000_000, efforts: [] }],
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never)
  for (const name of ['agent.register', 'tool.register', 'command.register'] as const) on(name, () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.usage', () => ({ value: { rateLimits: [], context: { window: 200_000 } } }) as never)
  on('session.start', () => ({ cwd: '/p' }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  let argv: readonly string[] = []
  let release = () => {}
  const gate = new Promise<void>(resolve => (release = resolve))
  on('process.spawn', async function* (_$, e) {
    argv = e.argv
    const step = { conversation_id: 'c', step_index: 2, state: 'ACTIVE', step_type: 'tool', tool_name: 'write_to_file', tool_info: { parameters: { TargetFile: '/p/docs/survey.md' } } }
    yield { stream: 'stdout' as const, text: `${JSON.stringify({ event: 'init', init: { model: 'gemini-3.8-flash-high' } })}\n${JSON.stringify({ event: 'step_update', step_update: step })}\n` }
    await gate
    yield { stream: 'stdout' as const, text: `${JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Wrote docs/survey.md' } })}\n` }
    return { value: { code: 0, signal: null } } as never
  })
  await $.session.start({ source: 'startup', cwd: '/p' } as never)

  const started = await $.tool.call({ tool: 'mcp__orchestra__delegate', provider: 'agy', model: 'gemini-3.8-flash-high', label: 'gemini-survey', task: 'Survey the repo into docs/survey.md' })
  expect(String(started.result)).toContain('effort high')
  expect(argv.join(' ')).toContain('--model gemini-3.8-flash-high')
  expect(argv.join(' ')).not.toContain('--effort')
  expect(argv.join(' ')).toContain('--sandbox --dangerously-skip-permissions')
  await new Promise(resolve => setTimeout(resolve, 20))

  const ui = await $.ui.mount({ plugin: 'orchestra', surface: 'desktop', ...PANE })

  await expandAll(ui)
  expect(await ui.find({ type: 'Text', text: /Gemini \(AGY\) 1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /● gemini-survey/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /write_to_file docs\/survey\.md/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1000k/ })).toBeDefined()
  await ui.unmount()

  release()
  await new Promise(resolve => setTimeout(resolve, 50))
  const board = await $.tool.call({ tool: 'mcp__orchestra__board', action: 'read' })
  expect(String(board.result)).toContain('gemini-survey → orchestrator: Report: .orchestra/reports/')
  expect(String(board.result)).toContain('Wrote docs/survey.md')
})

test('agents sit in groups with their goal, split by Claude, Codex and Gemini, on the terminal and the desktop', async ($, on) => {
  mock.clock(on, { now: 0 })
  mock.store(on, {
    catalog: [{ provider: 'codex', id: 'gpt-6-luna', name: 'Fast', window: 272_000, efforts: ['medium'] }],
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never)
  for (const name of ['agent.register', 'tool.register', 'command.register'] as const) on(name, () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.usage', () => ({ value: { rateLimits: [], context: { window: 200_000 } } }) as never)
  on('session.start', () => ({ cwd: '/p' }) as never)
  on('process.spawn', async function* () {
    await new Promise(() => {})
    return { value: { code: 0, signal: null } } as never
  })
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `a${++n}` }))
  await $.session.start({ source: 'startup', cwd: '/p' } as never)
  await $.tool.call({ tool: 'mcp__orchestra__board', action: 'group', group: 'UI', text: 'Builds the nav bar and footer' })
  await $.agent.spawn({ prompt: 'nav', description: 'UI: nav bar', subagentType: 'orchestra:builder' } as never)
  await $.agent.spawn({ prompt: 'check', description: 'QA: review', subagentType: 'orchestra:reviewer' } as never)
  await $.tool.call({ tool: 'mcp__orchestra__delegate', provider: 'codex', label: 'footer', task: 'Build the footer', group: 'UI' })

  await $.tool.call({ tool: 'mcp__orchestra__board', action: 'post', to: 'UI', text: 'use the new tokens', agentId: 'a2' } as never)
  const board = await $.tool.call({ tool: 'mcp__orchestra__board', action: 'read', agentId: 'a1' } as never)
  expect(String(board.result)).toContain('review → UI: use the new tokens')
  expect(String(board.result)).toContain('UI: Builds the nav bar and footer')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'orchestra', surface, ...PANE } as never)
    await expandAll(ui)
    expect(await ui.find({ type: 'Text', text: /▣ UI/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\(2 agents, 2 running\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Builds the nav bar and footer/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▣ QA/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ · 2 running · 0 done · nav bar, review$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ · 1 running · 0 done · footer$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /running · Claude 2 · Codex 1/ })).toBeDefined()
    await ui.unmount()
  }
})

test('agents nobody grouped get a group and a goal by themselves', async ($, on) => {
  mock.clock(on, { now: 0 })
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `b${++n}` }))
  await $.agent.spawn({ prompt: 'Fix the typos in README', description: 'typos', subagentType: 'orchestra:polisher' } as never)
  await $.agent.spawn({ prompt: 'Build the checkout form', description: 'Shop: checkout', subagentType: 'orchestra:builder' } as never)
  await $.agent.spawn({ prompt: 'Wire the form to the API', description: 'api wiring', subagentType: 'general-purpose', parentAgentId: 'b2' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'orchestra', surface, ...PANE } as never)
    await expandAll(ui)
    expect(await ui.find({ type: 'Text', text: /▣ Polish/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Fixes wording, typos and formatting/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▣ Shop.*2 agents/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Working on: Build the checkout form/ })).toBeDefined()
    await ui.unmount()
  }
})

const memoryFs = (on: Parameters<Parameters<typeof test>[1]>[1]) => {
  const files = new Map<string, string>()
  // The engine hands hooks absolute paths under the session's folder; keys stay project-relative.
  const key = (path: string) => path.replace(/^.*?(?=\.orchestra\/)/, '')
  on('fs.exists', (_$, e) => ({ value: files.has(key(e.path)) }) as never)
  on('fs.read', (_$, e) => (files.has(key(e.path)) ? { value: files.get(key(e.path)) } : { deny: 'missing' }) as never)
  on('fs.write', (_$, e) => {
    files.set(key(e.path), e.text)
    return { value: undefined } as never
  })
  return files
}

const bootWith = async ($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], catalog: unknown[]) => {
  mock.clock(on, { now: Date.parse('2099-03-04T05:06:00Z') })
  mock.store(on, { catalog })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never)
  for (const name of ['agent.register', 'tool.register', 'command.register'] as const) on(name, () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.usage', () => ({ value: { rateLimits: [], context: { window: 200_000 } } }) as never)
  on('session.start', () => ({ cwd: '/p' }) as never)
}

test('an external agent leaves a Markdown report for its reader, the board file stays current, and another model reviews it', async ($, on) => {
  const files = memoryFs(on)
  await bootWith($, on, [{ provider: 'codex', id: 'gpt-6.1-sol', name: 'Workhorse', window: 500_000, efforts: ['high'] }])
  const reviews: string[] = []
  on('agent.spawn', (_$, e) => {
    const raw = e as never as Record<string, unknown>
    reviews.push(`${String(raw.subagentType ?? raw.subagent_type)} | ${e.description} | ${e.prompt}`)
    return { model: 'claude-sonnet-5-5', agentId: `r${reviews.length}` }
  })
  const submitted: string[] = []
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text } as never
  })
  on('process.spawn', async function* (_$, e) {
    const out = e.argv[e.argv.indexOf('-o') + 1] ?? ''
    files.set(out, '## Summary\nAdded fetchMenu.\n## Messages\nTO UI: menu API ready')
    yield { stream: 'stdout' as const, text: `${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'short' } })}\n` }
    return { value: { code: 0, signal: null } } as never
  })
  await $.session.start({ source: 'startup', cwd: '/p' } as never)

  await $.tool.call({ tool: 'mcp__orchestra__delegate', provider: 'codex', label: 'api', task: 'Add fetchMenu', group: 'API', reportTo: 'UI', review: 'claude', files: ['/p/src/api.ts'] } as never)
  expect(files.get('.orchestra/BOARD.md') ?? '').toContain('**api** (API, Codex')
  await new Promise(resolve => setTimeout(resolve, 60))

  const report = [...files.entries()].find(([path]) => path.startsWith('.orchestra/reports/'))
  expect(report?.[0]).toBe('.orchestra/reports/20990304-0506-codex-1.md')
  expect(report?.[1]).toContain('# api — finished')
  expect(report?.[1]).toContain('report for: UI · reviewed by: Claude')
  expect(report?.[1]).toContain('Added fetchMenu.')
  expect(files.get('.orchestra/.gitignore')).toBe('*\n')
  expect(files.get('.orchestra/BOARD.md') ?? '').toContain('**api** → **UI**: menu API ready')

  const board = await $.tool.call({ tool: 'mcp__orchestra__board', action: 'read' })
  expect(String(board.result)).toContain('api → UI: Report: .orchestra/reports/20990304-0506-codex-1.md')
  expect(submitted.join('\n')).toContain('Review: started an orchestra:reviewer')
  expect(reviews[0]).toMatch(/^orchestra:reviewer \| API: review api \| Review the work of agent "api".*codex-1\.md/)

  const ui = await $.ui.mount({ plugin: 'orchestra', surface: 'terminal', ...PANE } as never)

  await expandAll(ui)
  expect(await ui.find({ type: 'Text', text: /▤ report: \.orchestra\/reports\/20990304-0506-codex-1\.md/ })).toBeDefined()
  await ui.unmount()
})

test('an agent that ends without any report is marked failed and still leaves a report file with its activity', async ($, on) => {
  const files = memoryFs(on)
  await bootWith($, on, [{ provider: 'agy', id: 'gemini-3.8-flash-high', name: 'Gemini', window: 1_000_000, efforts: [] }])
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  on('process.spawn', async function* () {
    const step = { state: 'ACTIVE', tool_name: 'run_command', tool_info: { parameters: {} } }
    yield { stream: 'stdout' as const, text: `${JSON.stringify({ event: 'step_update', step_update: step })}\n${JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: '' } })}\n` }
    return { value: { code: 0, signal: null } } as never
  })
  await $.session.start({ source: 'startup', cwd: '/p' } as never)
  await $.tool.call({ tool: 'mcp__orchestra__delegate', provider: 'agy', label: 'gemini-web', task: 'Audit the web folder', write: false } as never)
  await new Promise(resolve => setTimeout(resolve, 60))

  const report = [...files.entries()].find(([path]) => path.startsWith('.orchestra/reports/'))?.[1] ?? ''
  expect(report).toContain('# gemini-web — FAILED')
  expect(report).toContain('ended without a report (last step: run_command)')
  expect(report).toContain('- run_command')
  const board = await $.tool.call({ tool: 'mcp__orchestra__board', action: 'read' })
  expect(String(board.result)).toContain('gemini-web → orchestrator: FAILED (ended without a report')
})

const OPENCODE_MODELS = 'github-copilot/claude-sonnet-5.5\nopencode/big-pickle\nopencode/deepseek-v4.1-flash-free\nopencode/nemotron-3-ultra-free\n'
const KIMI_TOML = '[models."kimi-code/k3"]\nprovider = "managed:kimi-code"\nmax_context_size = 1048576\ndisplay_name = "K3"\n\n[thinking]\nenabled = true\n'

test('OpenCode, Copilot and Kimi models are read from their CLIs, and a model the account refuses stops being offered', async ($, on) => {
  memoryFs(on)
  mock.clock(on, { now: Date.parse('2099-03-04T05:06:00Z') })
  mock.store(on)
  on('process.run', (_$, e) => {
    const cmd = e.argv.join(' ')
    const stdout = cmd.includes('opencode models') ? OPENCODE_MODELS : cmd.includes('copilot --version') ? '1.2.0' : cmd.includes('kimi-code/config.toml') ? KIMI_TOML : ''
    return { value: { exitCode: stdout ? 0 : 1, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  for (const name of ['agent.register', 'tool.register', 'command.register'] as const) on(name, () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.usage', () => ({ value: { rateLimits: [], context: { window: 200_000 } } }) as never)
  on('session.start', () => ({ cwd: '/p' }) as never)
  on('session.cwd', () => ({ value: '/p' }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'c1' }))
  on('tool.call', () => ({ result: 'ok' }))
  const runs: string[] = []
  on('process.spawn', async function* (_$, e) {
    const cmd = e.argv.join(' ')
    runs.push(cmd)
    if (cmd.includes('--model claude-sonnet-5.5')) {
      yield { stream: 'stderr' as const, text: 'Error: Model "claude-sonnet-5.5" from --model flag is not available.\n' }
      return { value: { code: 1, signal: null } } as never
    }
    if (cmd.includes('copilot')) {
      yield { stream: 'stdout' as const, text: `${JSON.stringify({ type: 'assistant.message', data: { model: 'gpt-5.6-luna', content: 'Reviewed.' } })}\n${JSON.stringify({ type: 'result', exitCode: 0, usage: { premiumRequests: 1 } })}\n` }
      return { value: { code: 0, signal: null } } as never
    }
    const lines = [
      { type: 'tool_use', part: { tool: 'write', state: { input: { path: 'src/hello.ts', content: 'x' } } } },
      { type: 'step_finish', part: { tokens: { input: 1200, cache: { read: 300 } } } },
      { type: 'text', part: { text: 'Wrote src/hello.ts\nTO orchestrator: done' } },
    ]
    yield { stream: 'stdout' as const, text: `${JSON.stringify(lines[0])}\n` }
    await new Promise(resolve => setTimeout(resolve, 30))
    yield { stream: 'stdout' as const, text: `${lines.slice(1).map(l => JSON.stringify(l)).join('\n')}\n` }
    return { value: { code: 0, signal: null } } as never
  })
  await $.session.start({ source: 'startup', cwd: '/p' } as never)

  const oc = await $.tool.call({ tool: 'mcp__orchestra__delegate', provider: 'opencode', model: 'nope', task: 'x' } as never)
  expect(String(oc.result)).toContain('Available: opencode/big-pickle, opencode/deepseek-v4.1-flash-free, opencode/nemotron-3-ultra-free.')
  const kimi = await $.tool.call({ tool: 'mcp__orchestra__delegate', provider: 'kimi', model: 'nope', task: 'x' } as never)
  expect(String(kimi.result)).toContain('Available: kimi-code/k3.')

  const started = await $.tool.call({ tool: 'mcp__orchestra__delegate', provider: 'opencode', model: 'opencode/big-pickle', label: 'pickle', task: 'Write src/hello.ts' } as never)
  expect(String(started.result)).toContain('Started OpenCode agent "pickle"')
  await new Promise(resolve => setTimeout(resolve, 10))
  expect(runs[0]).toContain('opencode run --format json --auto -m opencode/big-pickle')
  // A relative path from OpenCode is claimed as the absolute one Claude agents edit.
  await $.agent.spawn({ prompt: 'p', description: 'other', subagentType: 'orchestra:builder' } as never)
  const refused = await $.tool.call({ tool: 'Edit', file_path: '/p/src/hello.ts', agentId: 'c1' } as never)
  expect(String(refused.deny ?? '')).toContain('pickle')
  const ui = await $.ui.mount({ plugin: 'orchestra', surface: 'desktop', ...PANE } as never)
  await expandAll(ui)
  expect(await ui.find({ type: 'Text', text: /▾ OpenCode/ })).toBeDefined()
  await ui.unmount()
  await new Promise(resolve => setTimeout(resolve, 60))
  const board = await $.tool.call({ tool: 'mcp__orchestra__board', action: 'read' } as never)
  expect(String(board.result)).toContain('pickle → orchestrator: Report:')

  // Copilot is always auto: a named model and an effort are dropped, never passed.
  const cp = await $.tool.call({ tool: 'mcp__orchestra__delegate', provider: 'copilot', model: 'claude-sonnet-5.5', effort: 'high', label: 'cp', task: 'Review' } as never)
  expect(String(cp.result)).toContain('model auto')
  await new Promise(resolve => setTimeout(resolve, 60))
  expect(runs[1]).toContain('copilot -p')
  expect(runs[1]).not.toContain('--model')
  expect(runs[1]).not.toContain('--reasoning-effort')
  const after = await $.tool.call({ tool: 'mcp__orchestra__board', action: 'read' } as never)
  expect(String(after.result)).toContain('cp → orchestrator: Report:')
  expect(String(after.result)).toContain('Reviewed.')
  await $.tool.call({ tool: 'mcp__orchestra__delegate', provider: 'copilot', write: false, label: 'cp2', task: 'Review' } as never)
  await new Promise(resolve => setTimeout(resolve, 60))
  expect(runs[2]).toContain('--deny-tool=write')
  // An OpenCode task that names no model runs on the free DeepSeek one.
  await $.tool.call({ tool: 'mcp__orchestra__delegate', provider: 'opencode', label: 'ds', task: 'Draft', write: false } as never)
  await new Promise(resolve => setTimeout(resolve, 10))
  expect(runs[3]).toContain('-m opencode/deepseek-v4.1-flash-free')
  // Two Copilot tasks ran (cp and cp2): each spent a premium request.
  const pane = await $.ui.mount({ plugin: 'orchestra', surface: 'terminal', ...PANE } as never)
  await expandAll(pane)
  expect(await pane.find({ type: 'Text', text: /Copilot 2 premium requests this month/ })).toBeDefined()
  await pane.unmount()
})

test('a model out of credits is left out alone, not its whole CLI, and a sign-in refusal shuts the CLI', async ($, on) => {
  memoryFs(on)
  await bootWith($, on, [
    { provider: 'agy', id: 'gemini-3.8-flash-high', name: 'Gemini', window: 1_000_000, efforts: [] },
    { provider: 'agy', id: 'claude-sonnet-4-6', name: 'Sonnet', window: 200_000, efforts: ['low'] },
    { provider: 'kimi', id: 'kimi-code/k3', name: 'K3', window: 1_000_000, efforts: [] },
  ])
  on('session.cwd', () => ({ value: '/p' }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  on('process.spawn', async function* (_$, e) {
    const cmd = e.argv.join(' ')
    if (cmd.includes('kimi')) {
      yield { stream: 'stderr' as const, text: 'error: failed to run prompt: provider.auth_error: 403 Your current subscription does not have access to Kimi Code right now.\n' }
      return { value: { code: 1, signal: null } } as never
    }
    const ok = cmd.includes('gemini')
    const line = ok ? { event: 'result', result: { status: 'SUCCESS', response: 'Read it.' } } : { event: 'error', error: { message: 'Your AI credits balance is too low to continue.' } }
    yield { stream: 'stdout' as const, text: `${JSON.stringify(line)}\n` }
    return { value: { code: ok ? 0 : 1, signal: null } } as never
  })
  await $.session.start({ source: 'startup', cwd: '/p' } as never)
  await $.tool.call({ tool: 'mcp__orchestra__delegate', provider: 'agy', model: 'claude-sonnet-4-6', label: 'agy-sonnet', task: 'Read' } as never)
  await $.tool.call({ tool: 'mcp__orchestra__delegate', provider: 'kimi', model: 'kimi-code/k3', label: 'k', task: 'Read' } as never)
  await new Promise(resolve => setTimeout(resolve, 80))

  const board = String((await $.tool.call({ tool: 'mcp__orchestra__board', action: 'read' } as never)).result)
  const ui = await $.ui.mount({ plugin: 'orchestra', surface: 'desktop', ...PANE } as never)
  await expandAll(ui)
  expect(await ui.find({ type: 'Text', text: /claude-sonnet-4-6 refused by the account, retrying on gemini-3\.8-flash-high/ })).toBeDefined()
  await ui.unmount()
  expect(board).toContain('agy-sonnet → orchestrator: Report:')
  expect(board).toContain('Read it.')
  const sonnet = await $.tool.call({ tool: 'mcp__orchestra__delegate', provider: 'agy', model: 'claude-sonnet-4-6', task: 'x' } as never)
  expect(String(sonnet.result)).toContain('credits balance is too low')
  const kimi = await $.tool.call({ tool: 'mcp__orchestra__delegate', provider: 'kimi', task: 'x' } as never)
  expect(String(kimi.result)).toContain('kimi is refusing this account right now')
})

test('Codex offers only the newest model of each line, read live from the CLI', async ($, on) => {
  memoryFs(on)
  mock.clock(on, { now: 0 })
  mock.store(on)
  const models = ['gpt-5.6-sol', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-5.6-terra', 'gpt-6.1-terra', 'gpt-5.6-luna', 'gpt-6-luna']
  const debug = `warning: noise\n${JSON.stringify({ models: [...models.map(slug => ({ slug, visibility: 'list', context_window: 272000 })), { slug: 'codex-auto-review', visibility: 'hide' }] })}`
  const asked: string[] = []
  on('process.run', (_$, e) => {
    const cmd = e.argv.join(' ')
    asked.push(cmd)
    const isCodex = cmd.includes('codex debug models')
    return { value: { exitCode: isCodex ? 0 : 1, stdout: isCodex ? debug : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  for (const name of ['agent.register', 'tool.register', 'command.register'] as const) on(name, () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.usage', () => ({ value: { rateLimits: [], context: { window: 200_000 } } }) as never)
  on('session.start', () => ({ cwd: '/p' }) as never)
  await $.session.start({ source: 'startup', cwd: '/p' } as never)

  const old = await $.tool.call({ tool: 'mcp__orchestra__delegate', provider: 'codex', model: 'gpt-5.6-sol', task: 'x' } as never)
  expect(String(old.result)).toContain('Available: gpt-6.1-sol, gpt-6-astra, gpt-6.1-terra, gpt-6-luna.')
})

test('a long note between agents reaches the board condensed by Haiku, unless Haiku drops a path', async ($, on) => {
  mock.clock(on, { now: 0 })
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `h${++n}` }))
  const answers = ['nav: use fetchMenu from src/api.ts; footer link goes last.', 'nav: use fetchMenu.']
  on('model.complete', () => ({ value: { isAnswered: true, text: answers.shift() ?? '', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) as never)
  await $.agent.spawn({ prompt: 'nav', description: 'nav', subagentType: 'orchestra:builder' } as never)
  await $.agent.spawn({ prompt: 'api', description: 'api', subagentType: 'orchestra:builder' } as never)
  const long = `Hello nav, hope it goes well. ${'I finished the API work and wanted to tell you in detail. '.repeat(5)}Please use fetchMenu from src/api.ts and put the footer link last.`

  await $.tool.call({ tool: 'mcp__orchestra__board', action: 'post', to: 'NAV', text: long, agentId: 'h2' } as never)
  await $.tool.call({ tool: 'mcp__orchestra__board', action: 'post', to: 'nav', text: long, agentId: 'h2' } as never)
  const board = String((await $.tool.call({ tool: 'mcp__orchestra__board', action: 'read', agentId: 'h1' } as never)).result)
  // "NAV" reached the agent named nav, condensed; the second answer lost src/api.ts, so the original went through.
  expect(board).toContain('api → nav: nav: use fetchMenu from src/api.ts; footer link goes last.')
  expect(board).toContain('api → nav: Hello nav')
})

const TEAM = {
  component: 'Pane',
  requestId: 'orchestra-team',
  props: { title: 'Orchestra · Team', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 } },
} as const

test('the team pane shows who works with whom and sends the person\'s message to an agent', async ($, on) => {
  mock.clock(on, { now: 0 })
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `t${++n}` }))
  on('tool.call', () => ({ result: 'ok' }))
  await $.agent.spawn({ prompt: 'Build the nav', description: 'UI: nav', subagentType: 'orchestra:builder' } as never)
  await $.agent.spawn({ prompt: 'Build the footer', description: 'UI: footer', subagentType: 'orchestra:builder' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/p/src/nav.tsx', agentId: 't1' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/p/src/nav.tsx', agentId: 't2' } as never)
  await $.tool.call({ tool: 'mcp__orchestra__board', action: 'post', to: 'nav', text: 'add the footer link', agentId: 't2' } as never)
  await $.tool.call({ tool: 'mcp__orchestra__board', action: 'post', to: 'footer', text: 'done, go ahead', agentId: 't1' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'orchestra', surface, ...PANE } as never)
    expect(await ui.find({ type: 'Text', text: /footer \(Claude\) ⇄ nav \(Claude\) · 2 msgs/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /⏸ footer waits on nav: wants src\/nav\.tsx/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /✎ nav \(Claude\) edits/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ plugin: 'orchestra', surface: 'desktop', ...PANE } as never)
  await ui.select({ key: 'team-agent', value: 't1' } as never)
  expect(await ui.find({ type: 'Text', text: /✎ edits src\/nav\.tsx/ })).toBeDefined()
  await ui.select({ key: 'team-to', value: 'UI' } as never)
  await ui.input({ key: 'team-message', text: 'ship it by noon' } as never)
  await ui.press({ key: 'team-relay' } as never)
  expect(await ui.find({ type: 'Text', text: /^OFF · 0 condensed/ })).toBeDefined()
  await ui.unmount()
  const board = String((await $.tool.call({ tool: 'mcp__orchestra__board', action: 'read', agentId: 't2' } as never)).result)
  expect(board).toContain('you → UI: ship it by noon')
})

test('a file two agents work on shows who edits which function and who audits it', async ($, on) => {
  mock.clock(on, { now: 0 })
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `f${++n}` }))
  on('tool.call', () => ({ result: 'ok' }))
  await $.agent.spawn({ prompt: 'Build the nav', description: 'UI: nav', subagentType: 'orchestra:builder' } as never)
  await $.agent.spawn({ prompt: 'Review the nav', description: 'UI: review nav', subagentType: 'orchestra:reviewer' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/p/src/nav.tsx', old_string: 'export function NavBar() {\n  return null', new_string: 'x', agentId: 'f1' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/p/src/nav.tsx', old_string: '  const fetchMenu = async () => {', new_string: 'y', agentId: 'f1' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/p/src/nav.tsx', agentId: 'f2' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/p/docs/spec.md', agentId: 'f1' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'orchestra', surface, ...PANE } as never)
    await expandAll(ui)
    expect(await ui.find({ type: 'Text', text: /src\/nav\.tsx · 2 agents/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /✎ nav \(Claude\) edits · NavBar\(\), fetchMenu\(\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /◉ review nav \(Claude\) audits/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /◎ reads docs\/spec\.md/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ctx .* 0k\/200k 0%/ })).toBeDefined()
    await ui.unmount()
  }
})

test('lean mode is on by default for the chat and every agent, and /orchestra lean off turns it off', async ($, on) => {
  mock.clock(on, { now: 0 })
  mock.store(on, { catalog: [{ provider: 'codex', id: 'gpt-6-luna', name: 'Fast', window: 272_000, efforts: ['low'] }] })
  memoryFs(on)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never)
  for (const name of ['tool.register', 'command.register'] as const) on(name, () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.usage', () => ({ value: { rateLimits: [], context: { window: 200_000 } } }) as never)
  on('session.start', () => ({ cwd: '/p' }) as never)
  on('prompt.compose', () => ({ sections: [] }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  const roles: string[] = []
  on('agent.register', (_$, e) => {
    roles.push(String((e as never as { prompt: string }).prompt))
    return { value: undefined } as never
  })
  let argv = ''
  on('process.spawn', async function* (_$, e) {
    argv = e.argv.join(' ')
    return { value: { code: 0, signal: null } } as never
  })
  await $.session.start({ source: 'startup', cwd: '/p' } as never)
  expect(roles.every(p => p.includes('Lean rules'))).toBe(true)

  const ids = async () => ((await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [], sections: [] } as never)) as { sections: { id: string }[] }).sections.map(x => x.id)
  expect(await ids()).toContain('orchestra:lean')
  await $.tool.call({ tool: 'mcp__orchestra__delegate', provider: 'codex', label: 'x', task: 'Fix it' } as never)
  await new Promise(resolve => setTimeout(resolve, 10))
  expect(argv).toContain('Lean rules')

  const off = await $.command.run({ command: 'orchestra', args: 'lean off' } as never)
  expect(String((off as { text?: string }).text)).toContain('lean mode off')
  expect(await ids()).not.toContain('orchestra:lean')
})

test('the pane opens with the first prompt at any width, and stays shut once the person closes it', async ($, on) => {
  mock.clock(on, { now: 0 })
  mock.store(on)
  const opened: string[] = []
  let placed = false
  on('ui.panes', () => ({ value: placed ? [{ id: 'orchestra', title: 'Orchestra', isShown: true, isFocused: false, isPlaced: true }] : [] }) as never)
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    placed = true
    return { value: { isPlaced: true } } as never
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  await $.prompt.submit({ text: 'hola' } as never)
  await new Promise(resolve => setTimeout(resolve, 5))
  expect(opened).toEqual(['orchestra'])
  await $.prompt.submit({ text: 'otra' } as never)
  expect(opened.length).toBe(1)
})

test('a pane the person closed by hand is not reopened by a prompt', async ($, on) => {
  mock.clock(on, { now: 0 })
  mock.store(on, { paneClosed: true })
  const opened: string[] = []
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  await $.prompt.submit({ text: 'hola' } as never)
  await new Promise(resolve => setTimeout(resolve, 5))
  expect(opened).toEqual([])
})
