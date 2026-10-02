import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CostLedger, Limit, PaceLog, Snapshot, TokenLedger } from '../types'

const snap = atom({ plugin: 'statusline-band', key: 'snap' } as const, null)
const isCompacting = atom({ plugin: 'statusline-band', key: 'isCompacting' } as const, false)
const frame = atom({ plugin: 'statusline-band', key: 'frame' } as const, 0)
const isBlinking = atom({ plugin: 'statusline-band', key: 'isBlinking' } as const, false)
const lastTurn = atom({ plugin: 'statusline-band', key: 'lastTurn' } as const, null)

const LIMIT_LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }
const RINGS = ['○', '◔', '◑', '◕', '●']
const BAR_CELLS = 8
const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 }
// Too early in a window, one burst would read as a runaway pace
const PACE_MIN_ELAPSED = 0.05
// The recent pace: readings kept every 5 minutes over the last 3 hours, read once they span 30 minutes
const PACE_KEY = 'pace-v1'
const PACE_SAMPLE_MS = 5 * 60_000
const PACE_LOOKBACK_MS = 3 * 3_600_000
const PACE_MIN_SPAN_MS = 30 * 60_000
const ALERT_THRESHOLDS = [80, 95]
const COMPACT_AT = 80
const LEDGER_DAYS = 62
const ROLLING_DAYS = 30
const LEDGER_SESSIONS = 100
// v2: the first ledger counted a resumed session's whole past cost as today's
const COST_KEY = 'costs-v2'
// Tokens are counted by the mod at each turn's end, so they start from when it was installed
const TOKEN_KEY = 'tokens-v1'
const GIT_TIMEOUT = { timeoutMs: 5000 }
// Fetched in the background so "behind" stays true; never prompts for credentials
const FETCH_EVERY_MS = 5 * 60_000
const FETCH_INIT = {
  timeoutMs: 30_000,
  env: { GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' },
}
// Clawd, the Claude Code mascot, beside the panel in a shirt with the owner's initials:
// standing when idle, running while Claude works (arms and legs trade places each step,
// dust kicked up behind)
const CLAWD_COLOR = '#d97757'
const DUST_COLOR = '#78716c'
const SHIRT_COLOR = '#2563eb'
const SHIRT_TEXT = ' A H '
const CLAWD_HEAD = ' ▐▛███▜▌ '
const CLAWD_HEAD_BLINK = ' ▐█████▌ '
const BLINK_EVERY_MS = 4_500
const BLINK_FOR_MS = 300
const CLAWD_IDLE = { arms: ['▝', '▘'], legs: '  ▘▘ ▝▝  ' }
const CLAWD_RUN = [
  { arms: ['▝', '▘'], legs: ' ▘ ▘ ▝ ▝ ' },
  { arms: ['▗', '▖'], legs: '  ▝▘ ▘▝  ' },
]
const DUST = [['  ', '  ', ' ·'], ['  ', ' ·', '∙ '], ['  ', '  ', '· ']]
const CLAWD_WIDTH = 11
// Room left for the band's own collapse mark ([-]) on the right, with a margin
const ENGINE_MARK_WIDTH = 8
const RUNNER_TICK_MS = 120
// Empty rows above and below the stats, so the panel has room to breathe
const PAD_ROWS = 1
// Columns of card left and right of the frame
const CARD_INSET = 1
const RUNNER_MAX_TICKS = 15_000

const COLORS = {
  ok: '#4ade80',
  warn: '#fbbf24',
  hot: '#f87171',
  folder: '#fbbf24',
  branch: '#5eead4',
  model: '#7dd3fc',
  border: '#71717a',
  borderBusy: '#d97757',
  // The card behind the panel, a touch off pure black
  card: '#0a0a0a',
}

const toneHex = (pct: number) => (pct >= 80 ? COLORS.hot : pct >= 50 ? COLORS.warn : COLORS.ok)
const ring = (pct: number) => RINGS[Math.min(4, Math.round((pct / 100) * 4))]

// claude-opus-5-5 → Opus 5.5; anything else is shown as it came
const prettyModel = (id: string) => {
  const [, family, major, minor] = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(id) ?? []
  return family ? `${family[0]?.toUpperCase()}${family.slice(1)} ${major}.${minor}` : id
}

const formatTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}m` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`

const formatUsd = (usd: number) => (usd >= 100 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`)

const formatDuration = (ms: number) => {
  const secs = Math.max(0, Math.floor(ms / 1000))
  if (secs >= 3600) return `${Math.floor(secs / 3600)}h${Math.floor((secs % 3600) / 60)}m`
  if (secs >= 60) return `${Math.floor(secs / 60)}m`
  return `${secs}s`
}

const formatReset = (ms: number) => {
  const mins = Math.floor(ms / 60_000)
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  if (days > 0) return `${days}d${hours}h`
  if (hours > 0) return `${hours}h${mins % 60}m`
  return `${mins}m`
}

// How long until a window runs out, when that comes before its reset: at the faster of the
// pace across the whole window and the recent pace (percent per millisecond)
const runsOutIn = (kind: string, pct: number, resetMs: number, recentRate?: number) => {
  const windowMs = WINDOW_MS[kind]
  if (windowMs === undefined || pct <= 0 || pct >= 100) return undefined
  const elapsed = windowMs - resetMs
  if (elapsed < windowMs * PACE_MIN_ELAPSED) return undefined
  const rate = Math.max(pct / elapsed, recentRate ?? 0)
  const left = (100 - pct) / rate
  return left < resetMs ? left : undefined
}

// Filled cells for a percentage; any use at all shows at least one
const barCells = (pct: number) => (pct <= 0 ? 0 : Math.min(BAR_CELLS, Math.max(1, Math.round((pct / 100) * BAR_CELLS))))

let isRefreshing = false
let runner: { cancel: () => void } | null = null
let hasTimers = false

// The refresh and blink timers, started in session.start so they outlive any one event.
// The other hooks call it too, for a hot reload, which starts the module over without one
function startTimers($: EngineInterface) {
  if (hasTimers) return
  hasTimers = true
  $.clock.every(30_000, () => void refresh($))
  void fetchUpstream($)
  $.clock.every(FETCH_EVERY_MS, () => void fetchUpstream($))
  $.clock.every(BLINK_EVERY_MS, () => {
    void update($, isBlinking, () => true)
    $.clock.after(BLINK_FOR_MS, () => void update($, isBlinking, () => false))
  })
}

async function readGit($: EngineInterface, cwd: string): Promise<Snapshot['git']> {
  const head = await $.process.run(['git', '-C', cwd, 'symbolic-ref', '--short', 'HEAD'], GIT_TIMEOUT)
  const branch =
    head.exitCode === 0
      ? head.stdout.trim()
      : (await $.process.run(['git', '-C', cwd, 'rev-parse', '--short', 'HEAD'], GIT_TIMEOUT)).stdout.trim()
  if (!branch) return null

  const [status, counts, diff, outgoing, top, stashes, last] = await Promise.all([
    $.process.run(['git', '-C', cwd, 'status', '--porcelain'], GIT_TIMEOUT),
    $.process.run(['git', '-C', cwd, 'rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], GIT_TIMEOUT),
    $.process.run(['git', '-C', cwd, 'diff', '--shortstat', 'HEAD'], GIT_TIMEOUT),
    // Lines in the commits not yet pushed; fails harmlessly without an upstream
    $.process.run(['git', '-C', cwd, 'diff', '--shortstat', '@{upstream}...HEAD'], GIT_TIMEOUT),
    $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel'], GIT_TIMEOUT),
    $.process.run(['git', '-C', cwd, 'stash', 'list'], GIT_TIMEOUT),
    $.process.run(['git', '-C', cwd, 'log', '-1', '--format=%ct'], GIT_TIMEOUT),
  ])
  const lines = (shortstat: string) => ({
    added: Number(/(\d+) insertion/.exec(shortstat)?.[1] ?? 0),
    removed: Number(/(\d+) deletion/.exec(shortstat)?.[1] ?? 0),
  })
  const { added, removed } = lines(diff.stdout)
  const unpushed = lines(outgoing.exitCode === 0 ? outgoing.stdout : '')
  const hasUpstream = counts.exitCode === 0
  const [ahead = 0, behind = 0] = hasUpstream ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0]

  const changed = status.stdout.split('\n').filter(row => row.trim() !== '').length

  const stashed = stashes.stdout.split('\n').filter(row => row.trim() !== '').length

  return {
    root: top.exitCode === 0 ? top.stdout.trim() : null,
    branch,
    changed,
    hasUpstream,
    ahead,
    behind,
    added,
    removed,
    unpushedAdded: unpushed.added,
    unpushedRemoved: unpushed.removed,
    stashed,
    lastCommitAt: last.exitCode === 0 && last.stdout.trim() ? Number(last.stdout.trim()) * 1000 : null,
  }
}

async function fetchUpstream($: EngineInterface) {
  const cwd = await $.session.cwd()
  const fetched = await $.process.run(['git', '-C', cwd, 'fetch', '--quiet', '--no-tags'], FETCH_INIT).catch(() => null)
  if (fetched?.exitCode === 0) void refresh($)
}

// Adds what this session spent since its last reading to today's total, kept across sessions.
// A session first seen after it began before today (a resume, one open overnight) counts
// from that reading on, since what it spent earlier is not today's.
async function recordCost($: EngineInterface, sessionId: string, usd: number, day: string, isFromToday: boolean) {
  const stored = (await $.store.get(COST_KEY)) as CostLedger | undefined
  const ledger: CostLedger = stored ?? { days: {}, sessions: {} }
  const last = ledger.sessions[sessionId]
  if (last === undefined && !isFromToday) {
    ledger.sessions[sessionId] = usd
    await $.store.set(COST_KEY, ledger)
    return ledger
  }
  const delta = usd - (last ?? 0)
  if (delta <= 0) return ledger

  ledger.days[day] = (ledger.days[day] ?? 0) + delta
  ledger.sessions[sessionId] = usd
  const days = Object.keys(ledger.days).sort()
  for (const old of days.slice(0, Math.max(0, days.length - LEDGER_DAYS))) delete ledger.days[old]
  const sessions = Object.keys(ledger.sessions)
  for (const old of sessions.slice(0, Math.max(0, sessions.length - LEDGER_SESSIONS))) delete ledger.sessions[old]
  await $.store.set(COST_KEY, ledger)
  return ledger
}

// Adds a turn's tokens to its session's and today's totals, kept across sessions
async function recordTokens($: EngineInterface, sessionId: string, day: string, tokens: number) {
  const ledger = ((await $.store.get(TOKEN_KEY)) as TokenLedger | undefined) ?? { days: {}, sessions: {} }
  ledger.days[day] = (ledger.days[day] ?? 0) + tokens
  ledger.sessions[sessionId] = (ledger.sessions[sessionId] ?? 0) + tokens
  const days = Object.keys(ledger.days).sort()
  for (const old of days.slice(0, Math.max(0, days.length - LEDGER_DAYS))) delete ledger.days[old]
  const sessions = Object.keys(ledger.sessions)
  for (const old of sessions.slice(0, Math.max(0, sessions.length - LEDGER_SESSIONS))) delete ledger.sessions[old]
  await $.store.set(TOKEN_KEY, ledger)
}

// Keeps a reading of each window every few minutes, across sessions, and gives each window's
// recent pace in percent per millisecond: from the oldest reading in the lookback to now
async function recordPace($: EngineInterface, limits: Limit[], now: number) {
  const log = ((await $.store.get(PACE_KEY)) as PaceLog | undefined) ?? {}
  const next: PaceLog = {}
  const rates: Record<string, number> = {}
  let isChanged = false
  for (const l of limits) {
    if (!l.resetsAt) continue
    const id = `${l.kind}@${l.resetsAt}`
    const kept = (log[id] ?? []).filter(r => now - r.t <= PACE_LOOKBACK_MS)
    const last = kept[kept.length - 1]
    if (last === undefined || now - last.t >= PACE_SAMPLE_MS) {
      kept.push({ t: now, pct: l.percent })
      isChanged = true
    }
    next[id] = kept
    const oldest = kept[0]
    if (oldest !== undefined && now - oldest.t >= PACE_MIN_SPAN_MS && l.percent > oldest.pct) {
      rates[l.kind] = (l.percent - oldest.pct) / (now - oldest.t)
    }
  }
  if (isChanged || Object.keys(log).length !== Object.keys(next).length) await $.store.set(PACE_KEY, next)
  return rates
}

// Toasts once per window and threshold, even across sessions
async function alertLimits($: EngineInterface, limits: Limit[]) {
  const alerted = ((await $.store.get('alerted')) as string[] | undefined) ?? []
  const fresh: string[] = []
  for (const l of limits) {
    const crossed = ALERT_THRESHOLDS.filter(t => l.percent >= t).pop()
    if (crossed === undefined) continue
    const id = `${l.kind}@${l.resetsAt ?? ''}@${crossed}`
    if (alerted.includes(id)) continue
    fresh.push(id)
    const name = LIMIT_LABELS[l.kind] ?? l.kind
    $.ui.toast(`${crossed >= 95 ? '🔥' : '⚠️'}  ${name} limit at ${Math.round(l.percent)}%`, { timeoutMs: 8000 })
  }
  if (fresh.length > 0) await $.store.set('alerted', [...alerted, ...fresh].slice(-50))
}

// The reset moment in the machine's own timezone: "11:10 AM" within a day, else "Sat 8:00 PM"
async function localResetTime($: EngineInterface, iso: string, now: number) {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return undefined
  const format = ms - now < 86_400_000 ? '+%-I:%M %p' : '+%a %-I:%M %p'
  const { exitCode, stdout } = await $.process.run(['date', '-r', String(Math.floor(ms / 1000)), format])
  return exitCode === 0 ? stdout.trim() : undefined
}

// The repo's name, with the path below its root when the session runs in a subfolder
const placeFolder = (cwd: string, root: string | null) => {
  const base = (path: string) => path.split('/').filter(Boolean).pop() ?? path
  if (root === null || !cwd.startsWith(root)) return { folder: base(cwd), subdir: '' }
  return { folder: base(root), subdir: cwd.slice(root.length) }
}

async function refresh($: EngineInterface) {
  if (isRefreshing) return
  isRefreshing = true
  try {
    const cwd = await $.session.cwd()
    const [usage, model, now, clock, repo, sessionId] = await Promise.all([
      $.session.usage(),
      $.session.model(),
      $.clock.now(),
      $.process.run(['date', '+%Y-%m-%d|%I:%M %p|%H|%M|%S']),
      readGit($, cwd).catch(() => null),
      $.session.id(),
    ])
    const [day = '', time = '', hh, mm, ss] = clock.stdout.trim().split('|')
    const midnight = now - ((Number(hh) * 60 + Number(mm)) * 60 + Number(ss)) * 1000
    const costUsd = usage.cost?.usd ?? null
    const ledger = costUsd !== null ? await recordCost($, sessionId, costUsd, day, usage.startedAt >= midnight) : null
    const tokenLedger = (await $.store.get(TOKEN_KEY)) as TokenLedger | undefined
    // The ledger's days are local dates, so stepping back on a UTC calendar keeps them aligned
    const since = new Date(Date.parse(`${day}T00:00:00Z`) - (ROLLING_DAYS - 1) * 86_400_000).toISOString().slice(0, 10)
    const readings = await Promise.all(
      usage.rateLimits.map(async (l): Promise<Limit> => ({
        kind: l.kind,
        percent: l.percentUsed,
        resetsAt: l.resetsAt,
        resetsOn: l.resetsAt ? await localResetTime($, l.resetsAt, now) : undefined,
      })),
    )
    const rates = await recordPace($, readings, now)
    const limits = readings.map(l => ({ ...l, recentRate: rates[l.kind] }))
    const ctx = usage.context

    const next: Snapshot = {
      ...placeFolder(cwd, repo?.root ?? null),
      git: repo,
      model: prettyModel(model),
      startedAt: usage.startedAt,
      now,
      time,
      context:
        ctx.percent !== undefined ? { percent: ctx.percent, tokens: ctx.tokens ?? 0, window: ctx.window } : null,
      costUsd,
      todayUsd: ledger?.days[day] ?? null,
      tokens: {
        session: tokenLedger?.sessions[sessionId] ?? 0,
        today: tokenLedger?.days[day] ?? 0,
        rolling: Object.entries(tokenLedger?.days ?? {}).reduce(
          (sum, [d, n]) => (d >= since && d <= day ? sum + n : sum),
          0,
        ),
      },
      rollingUsd: ledger
        ? Object.entries(ledger.days).reduce((sum, [d, usd]) => (d >= since && d <= day ? sum + usd : sum), 0)
        : null,
      limits,
    }
    await update($, snap, () => next)
    await alertLimits($, limits)
  } finally {
    isRefreshing = false
  }
}

async function compactNow($: EngineInterface) {
  await update($, isCompacting, () => true)
  $.ui.toast('🗜  Compacting the conversation…')
  try {
    await $.session.compact()
    await refresh($)
  } finally {
    await update($, isCompacting, () => false)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    startTimers($)
    void refresh($)
    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    startTimers($)
    if (runner === null) {
      let ticks = 0
      const timer = $.clock.every(RUNNER_TICK_MS, () => {
        ticks += 1
        if (ticks > RUNNER_MAX_TICKS) timer.cancel()
        void update($, frame, n => n + 1)
      })
      runner = timer
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    startTimers($)
    const ran = await next(e)
    runner?.cancel()
    runner = null
    const used = ran.usage
    if (used) {
      const input = used.input_tokens + used.cache_read_input_tokens + used.cache_creation_input_tokens
      await update($, lastTurn, () => ({ input, output: used.output_tokens }))
      const [sessionId, clock] = await Promise.all([$.session.id(), $.process.run(['date', '+%Y-%m-%d'])])
      await recordTokens($, sessionId, clock.stdout.trim(), input + used.output_tokens)
    }
    void refresh($)
    return ran
  })

  on('tool.call', async ($, e, next) => {
    startTimers($)
    const ran = await next(e)
    void refresh($)
    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snap)
    if (e.props.hasSurvey || s === null) return next(e)
    const compacting = await read($, isCompacting)
    const turn = await read($, lastTurn)

    const { Box, Button, Text } = $.ui.resolve(e)

    // Pieces of text whose widths are known, so the frame can be drawn to fit them
    type Seg = { text: string; color?: string; bold?: boolean; dim?: boolean }
    const width = (segs: Seg[]) => segs.reduce((n, seg) => n + [...seg.text].length, 0)
    const draw = (segs: Seg[]) =>
      segs.map(seg => (
        <Text color={seg.color} bold={seg.bold} dimColor={seg.dim}>{seg.text}</Text>
      ))

    const border = e.props.isWorking ? COLORS.borderBusy : COLORS.border
    const line = (text: string): Seg => ({ text, color: border })
    const total = Math.max(40, e.props.bodyColumns - 2 - CLAWD_WIDTH - ENGINE_MARK_WIDTH - CARD_INSET * 2)

    // Top edge: the project as the panel's title
    const g = s.git
    const sep: Seg = { text: ' · ', dim: true }
    const diffSegs = (added: number, removed: number): Seg[] => [
      ...(added > 0 ? [{ text: ` +${added}`, color: COLORS.ok }] : []),
      ...(removed > 0 ? [{ text: ` −${removed}`, color: COLORS.hot }] : []),
    ]
    // Each git fact is its own group: uncommitted work, commits to push and pull, then the last commit
    const gitGroups: Seg[][] =
      g === null
        ? []
        : [
            ...(g.changed > 0
              ? [[{ text: `✎ ${g.changed} ${g.changed === 1 ? 'file' : 'files'}`, color: COLORS.warn }, ...diffSegs(g.added, g.removed)]]
              : []),
            ...(g.ahead > 0
              ? [
                  [
                    { text: `↑ ${g.ahead} ${g.ahead === 1 ? 'commit' : 'commits'}`, color: COLORS.warn },
                    ...diffSegs(g.unpushedAdded, g.unpushedRemoved),
                  ],
                ]
              : []),
            ...(g.behind > 0 ? [[{ text: `↓ ${g.behind} behind`, color: COLORS.hot }]] : []),
            ...(g.stashed > 0 ? [[{ text: `≡ ${g.stashed} stash`, color: COLORS.model }]] : []),
            ...(g.changed === 0 && g.hasUpstream && g.ahead === 0 && g.behind === 0
              ? [[{ text: '✓ synced', color: COLORS.ok }]]
              : []),
            ...(g.lastCommitAt !== null
              ? [[{ text: `committed ${s.now - g.lastCommitAt < 60_000 ? 'just now' : `${formatReset(s.now - g.lastCommitAt)} ago`}`, dim: true }]]
              : []),
            ...(!g.hasUpstream ? [[{ text: 'no upstream', color: COLORS.warn }]] : []),
          ]
    const title: Seg[] = [
      line('╭─ '),
      { text: `◆ ${s.folder}`, color: COLORS.folder, bold: true },
      ...(s.subdir ? [{ text: s.subdir, dim: true }] : []),
      ...(g === null ? [] : [line(' ─ '), { text: g.branch, color: COLORS.branch }]),
      line(' ─ '),
      { text: `✦ ${s.model}`, color: COLORS.model },
      { text: ' ' },
    ]
    // Top right: what the session, today and the last 30 days have cost
    const hours = (s.now - s.startedAt) / 3_600_000
    const cost: Seg[] = []
    const costShort: Seg[] = []
    // A snapshot kept from before a reload may predate the token counts
    const counted = (s.tokens as Snapshot['tokens'] | undefined) ?? { session: 0, today: 0, rolling: 0 }
    if (s.costUsd !== null) {
      // Each total is its cost, then its tokens once any are counted
      const tokens = (n: number): Seg[] => (n > 0 ? [{ text: ` ${formatTokens(n)}`, color: COLORS.model }] : [])
      cost.push(
        { text: ' ' },
        { text: formatUsd(s.costUsd), color: COLORS.ok, bold: true },
        ...tokens(counted.session),
        { text: ' session', dim: true },
      )
      costShort.push(...cost, { text: ' ' })
      if (hours > 0.05) cost.push({ text: ` ${formatUsd(s.costUsd / hours)}/h`, dim: true })
      const addTotal = (usd: number, n: number, label: string) =>
        cost.push(
          { text: ' · ', dim: true },
          { text: formatUsd(usd), color: COLORS.ok },
          ...tokens(n),
          { text: ` ${label}`, dim: true },
        )
      // Today only when it adds to the session; the 30 days always, even while it matches today
      if (s.todayUsd !== null && s.todayUsd - s.costUsd >= 0.01) addTotal(s.todayUsd, counted.today, 'today')
      if (s.rollingUsd !== null) addTotal(s.rollingUsd, counted.rolling, `${ROLLING_DAYS}d`)
      cost.push({ text: ' ' })
    }
    // When the whole line does not fit beside the title, the session cost alone still shows
    const fits = (segs: Seg[]) => width(title) + width(segs) + 3 <= total
    const right = fits(cost) ? cost : fits(costShort) ? costShort : []
    const top = [...title, line('─'.repeat(Math.max(1, total - width(title) - width(right) - 2))), ...right, line('─╮')]

    // Bottom edge: the git groups on the left; the last turn's tokens, how long the session has run and the time on the right
    const changes: Seg[] =
      gitGroups.length === 0 ? [] : [{ text: ' ' }, ...gitGroups.flatMap((group, i) => (i === 0 ? group : [sep, ...group])), { text: ' ' }]
    const clock: Seg[] = [
      { text: ' ' },
      // The last turn's tokens, its responses summed: read in (cache included) and written out
      ...(turn
        ? [
            { text: 'in ', dim: true },
            { text: formatTokens(turn.input), color: COLORS.model },
            { text: ' · out ', dim: true },
            { text: formatTokens(turn.output), color: COLORS.model },
            { text: ' · ', dim: true },
          ]
        : []),
      { text: `session ${formatDuration(s.now - s.startedAt)}`, dim: true },
      { text: ' · ', dim: true },
      { text: s.time, dim: true },
      { text: ' ' },
    ]
    const fill = Math.max(1, total - width(changes) - width(clock) - 4)
    const bottom = [line('╰─'), ...changes, line('─'.repeat(fill)), ...clock, line('─╯')]

    const tick = e.props.isWorking ? await read($, frame) : null
    const step = tick === null ? 0 : Math.floor(tick / 2)
    const pose = tick === null ? CLAWD_IDLE : CLAWD_RUN[step % CLAWD_RUN.length] ?? CLAWD_IDLE
    const dust = tick === null ? null : DUST[step % DUST.length]
    const blink = tick === null && (await read($, isBlinking))
    const puff = (row: number) => <Text color={DUST_COLOR}>{dust?.[row] ?? '  '}</Text>
    const clawd = (
      <Box flexDirection="column" width={CLAWD_WIDTH} flexShrink={0}>
        <Text>
          {puff(0)}
          <Text color={CLAWD_COLOR}>{blink ? CLAWD_HEAD_BLINK : CLAWD_HEAD}</Text>
        </Text>
        <Text>
          {puff(1)}
          <Text color={CLAWD_COLOR}>{pose.arms[0]}</Text>
          <Text color={SHIRT_COLOR}>▜</Text>
          <Text backgroundColor={SHIRT_COLOR} color="#ffffff" bold>{SHIRT_TEXT}</Text>
          <Text color={SHIRT_COLOR}>▛</Text>
          <Text color={CLAWD_COLOR}>{pose.arms[1]}</Text>
        </Text>
        <Text>
          {puff(2)}
          <Text color={CLAWD_COLOR}>{pose.legs}</Text>
        </Text>
      </Box>
    )

    // Middle: one block per window, side by side between thin dividers
    const stat = (pct: number, label: string, extra: Seg[] = []): Seg[] => [
      { text: `${ring(pct)} `, color: toneHex(pct) },
      { text: `${Math.round(pct)}%`, bold: true, color: pct >= 50 ? toneHex(pct) : undefined },
      { text: ` ${label}`, dim: true },
      ...extra,
    ]
    const stats: Seg[][] = [
      ...s.limits.map(l => {
        const resetMs = l.resetsAt ? Date.parse(l.resetsAt) - s.now : 0
        const name = LIMIT_LABELS[l.kind] ?? l.kind
        if (resetMs <= 0) return stat(l.percent, name)
        const out = runsOutIn(l.kind, l.percent, resetMs, l.recentRate)
        return stat(l.percent, `${name} · reset ${formatReset(resetMs)}`, [
          ...(l.resetsOn ? [{ text: ` (${l.resetsOn})`, dim: true }] : []),
          ...(out !== undefined ? [{ text: ` ▲ out ~${formatReset(out)}`, color: COLORS.hot, bold: true }] : []),
        ])
      }),
      ...(s.context
        ? [
            [
              { text: 'ctx ', dim: true },
              { text: '━'.repeat(barCells(s.context.percent)), color: toneHex(s.context.percent) },
              { text: '━'.repeat(BAR_CELLS - barCells(s.context.percent)), dim: true },
              {
                text: ` ${Math.round(s.context.percent)}%`,
                bold: true,
                color: s.context.percent >= 50 ? toneHex(s.context.percent) : undefined,
              },
              { text: ` ${formatTokens(s.context.tokens)}/${formatTokens(s.context.window)}`, dim: true },
            ],
          ]
        : []),
    ]

    // Drop the last blocks first when the terminal is too narrow for one row
    const divider: Seg = { text: '   │   ', color: border }
    const room = total - 8
    while (stats.length > 1 && stats.reduce((n, st) => n + width(st) + width([divider]), 0) > room) stats.pop()
    const row = stats.flatMap((st, i) => (i === 0 ? st : [divider, ...st]))

    const ctxFull = s.context !== null && s.context.percent >= COMPACT_AT
    // A side of the frame, one "│" per row of the stats and their padding
    const edge = (side: string) => (
      <Box flexDirection="column">
        {Array.from({ length: PAD_ROWS * 2 + 1 }, (_, i) => (
          <Text key={`${side}${i}`} wrap="truncate">{draw([line('│')])}</Text>
        ))}
      </Box>
    )

    return (
      <Box paddingX={1} alignItems="center">
        {clawd}
        {/* The card's own edge columns are painted over below its first row, so the frame sits one in */}
        <Box flexDirection="column" backgroundColor={COLORS.card} paddingX={CARD_INSET}>
          <Text wrap="truncate">{draw(top)}</Text>
          <Box width={total}>
            {edge('l')}
            <Box flexGrow={1} paddingX={2} paddingY={PAD_ROWS} justifyContent="space-between">
              <Text wrap="truncate">{draw(row)}</Text>
              {ctxFull && !e.props.isWorking && (
                <Button
                  key="compact"
                  label={compacting ? 'compacting…' : '🗜 compact'}
                  hotkey="c"
                  variant="primary"
                  onPress={() => (compacting ? undefined : compactNow($))}
                />
              )}
            </Box>
            {edge('r')}
          </Box>
          <Text wrap="truncate">{draw(bottom)}</Text>
        </Box>
      </Box>
    )
  })
}
