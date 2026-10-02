import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CostLedger, Limit, Snapshot } from '../types'

const snap = atom({ plugin: 'statusline-band', key: 'snap' } as const, null)
const history = atom({ plugin: 'statusline-band', key: 'ctxHistory' } as const, [])
const isCompacting = atom({ plugin: 'statusline-band', key: 'isCompacting' } as const, false)
const frame = atom({ plugin: 'statusline-band', key: 'frame' } as const, 0)
const isBlinking = atom({ plugin: 'statusline-band', key: 'isBlinking' } as const, false)

const LIMIT_LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }
const RINGS = ['○', '◔', '◑', '◕', '●']
// Low blocks only, so the trend stays a thin line beside the text
const SPARKS = '▁▂▃▄'
const HISTORY_LEN = 12
const ALERT_THRESHOLDS = [80, 95]
const COMPACT_AT = 80
const LEDGER_DAYS = 62
const LEDGER_SESSIONS = 100
// v2: the first ledger counted a resumed session's whole past cost as today's
const COST_KEY = 'costs-v2'
const GIT_TIMEOUT = { timeoutMs: 5000 }
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
const RUNNER_MAX_TICKS = 15_000

const COLORS = {
  ok: '#4ade80',
  warn: '#fbbf24',
  hot: '#f87171',
  folder: '#fbbf24',
  branch: '#5eead4',
  model: '#7dd3fc',
  spark: '#fdba74',
  border: '#71717a',
  borderBusy: '#d97757',
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

// Scaled to the trend's own range (at least 5 points), so a flat context reads as a flat line
// Scaled to the trend's own range (at least 5 points), so a flat context reads as a flat line
const sparkline = (values: number[]) => {
  const lo = Math.min(...values)
  const span = Math.max(5, Math.max(...values) - lo)
  return values.map(v => SPARKS[Math.min(3, Math.floor(((v - lo) / span) * 3.99))]).join('')
}

let isRefreshing = false
let runner: { cancel: () => void } | null = null

async function readGit($: EngineInterface, cwd: string): Promise<Snapshot['git']> {
  const head = await $.process.run(['git', '-C', cwd, 'symbolic-ref', '--short', 'HEAD'], GIT_TIMEOUT)
  const branch =
    head.exitCode === 0
      ? head.stdout.trim()
      : (await $.process.run(['git', '-C', cwd, 'rev-parse', '--short', 'HEAD'], GIT_TIMEOUT)).stdout.trim()
  if (!branch) return null

  const [status, counts, diff] = await Promise.all([
    $.process.run(['git', '-C', cwd, 'status', '--porcelain'], GIT_TIMEOUT),
    $.process.run(['git', '-C', cwd, 'rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], GIT_TIMEOUT),
    $.process.run(['git', '-C', cwd, 'diff', '--shortstat', 'HEAD'], GIT_TIMEOUT),
  ])
  const added = Number(/(\d+) insertion/.exec(diff.stdout)?.[1] ?? 0)
  const removed = Number(/(\d+) deletion/.exec(diff.stdout)?.[1] ?? 0)
  const hasUpstream = counts.exitCode === 0
  const [ahead = 0, behind = 0] = hasUpstream ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0]

  return { branch, isDirty: status.stdout.trim() !== '', hasUpstream, ahead, behind, added, removed }
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

// The reset moment in the machine's own timezone, as "Sat 7:00 PM"
async function localDateTime($: EngineInterface, iso: string) {
  const epoch = Math.floor(Date.parse(iso) / 1000)
  if (!Number.isFinite(epoch)) return undefined
  const { exitCode, stdout } = await $.process.run(['date', '-r', String(epoch), '+%a %-I:%M %p'])
  return exitCode === 0 ? stdout.trim() : undefined
}

async function refresh($: EngineInterface, isTurnEnd = false) {
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
    const month = day.slice(0, 7)
    const limits = await Promise.all(
      usage.rateLimits.map(async (l): Promise<Limit> => ({
        kind: l.kind,
        percent: l.percentUsed,
        resetsAt: l.resetsAt,
        resetsOn: l.kind === 'seven_day' && l.resetsAt ? await localDateTime($, l.resetsAt) : undefined,
      })),
    )
    const ctx = usage.context

    const next: Snapshot = {
      folder: cwd.split('/').filter(Boolean).pop() ?? cwd,
      git: repo,
      model: prettyModel(model),
      startedAt: usage.startedAt,
      now,
      time,
      context:
        ctx.percent !== undefined ? { percent: ctx.percent, tokens: ctx.tokens ?? 0, window: ctx.window } : null,
      costUsd,
      todayUsd: ledger?.days[day] ?? null,
      monthUsd: ledger
        ? Object.entries(ledger.days).reduce((sum, [d, usd]) => (d.startsWith(month) ? sum + usd : sum), 0)
        : null,
      limits,
    }
    await update($, snap, () => next)
    await alertLimits($, limits)
    if (isTurnEnd && next.context) {
      const pct = next.context.percent
      await update($, history, list => [...list, pct].slice(-HISTORY_LEN))
    }
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
    void refresh($)
    $.clock.every(30_000, () => void refresh($))
    $.clock.every(BLINK_EVERY_MS, () => {
      void update($, isBlinking, () => true)
      $.clock.after(BLINK_FOR_MS, () => void update($, isBlinking, () => false))
    })
    return ran
  })

  on('prompt.submit', async ($, e, next) => {
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
    const ran = await next(e)
    runner?.cancel()
    runner = null
    void refresh($, true)
    return ran
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    void refresh($)
    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snap)
    if (e.props.hasSurvey || s === null) return next(e)
    const trend = await read($, history)
    const compacting = await read($, isCompacting)

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
    const total = Math.max(40, e.props.bodyColumns - 2 - CLAWD_WIDTH - ENGINE_MARK_WIDTH)

    // Top edge: the project as the panel's title
    const g = s.git
    const gitSegs: Seg[] =
      g === null
        ? []
        : [
            line(' ─ '),
            { text: ` ${g.branch}`, color: COLORS.branch },
            ...(g.isDirty
              ? [
                  { text: ' ●', color: COLORS.hot },
                  ...(g.added > 0 ? [{ text: ` +${g.added}`, color: COLORS.ok }] : []),
                  ...(g.removed > 0 ? [{ text: ` −${g.removed}`, color: COLORS.hot }] : []),
                ]
              : !g.hasUpstream
                ? [{ text: ' ↑', color: COLORS.warn }]
                : [
                    ...(g.ahead > 0 ? [{ text: ` ↑${g.ahead}`, color: COLORS.warn }] : []),
                    ...(g.behind > 0 ? [{ text: ` ↓${g.behind}`, color: COLORS.hot }] : []),
                    ...(g.ahead === 0 && g.behind === 0 ? [{ text: ' ✓', color: COLORS.ok }] : []),
                  ]),
          ]
    const title: Seg[] = [
      line('╭─ '),
      { text: `◆ ${s.folder}`, color: COLORS.folder, bold: true },
      ...gitSegs,
      line(' ─ '),
      { text: `✦ ${s.model}`, color: COLORS.model },
      { text: ' ' },
    ]
    const top = [...title, line('─'.repeat(Math.max(1, total - width(title) - 1))), line('╮')]

    // Bottom edge: how long the session has run, and the time
    const clock: Seg[] = [
      { text: ' ' },
      { text: formatDuration(s.now - s.startedAt), dim: true },
      { text: ' · ', dim: true },
      { text: s.time, dim: true },
      { text: ' ' },
    ]
    const fill = Math.max(1, total - width(clock) - 3)
    const bottom = [line('╰'), line('─'.repeat(fill)), ...clock, line('─╯')]

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

    // Middle: one stat per window, spread across the panel
    const stat = (pct: number, label: string, extra: Seg[] = []): Seg[] => [
      { text: `${ring(pct)} `, color: toneHex(pct) },
      { text: `${Math.round(pct)}%`, bold: true, color: pct >= 50 ? toneHex(pct) : undefined },
      { text: ` ${label}`, dim: true },
      ...extra,
    ]
    const hours = (s.now - s.startedAt) / 3_600_000
    const stats: Seg[][] = [
      ...s.limits.map(l => {
        const resetMs = l.resetsAt ? Date.parse(l.resetsAt) - s.now : 0
        const name = LIMIT_LABELS[l.kind] ?? l.kind
        const when = [l.resetsOn, resetMs > 0 ? formatReset(resetMs) : undefined].filter(Boolean).join(' · ')
        return stat(l.percent, when ? `${name} · ${when}` : name)
      }),
      ...(s.context
        ? [
            stat(s.context.percent, `ctx ${formatTokens(s.context.tokens)}/${formatTokens(s.context.window)}`,
              trend.length > 1 ? [{ text: ` ${sparkline(trend)}`, color: COLORS.spark }] : []),
          ]
        : []),
    ]
    if (s.costUsd !== null) {
      const cost: Seg[] = [{ text: formatUsd(s.costUsd), color: COLORS.ok, bold: true }]
      if (hours > 0.05) cost.push({ text: ` ${formatUsd(s.costUsd / hours)}/h`, dim: true })
      const extras: [number | null, string][] = [[s.todayUsd, 'today'], [s.monthUsd, 'mo']]
      let shown = s.costUsd
      for (const [usd, label] of extras) {
        if (usd === null || usd - shown < 0.01) continue
        cost.push({ text: '  ·  ', dim: true }, { text: formatUsd(usd), color: COLORS.ok }, { text: ` ${label}`, dim: true })
        shown = usd
      }
      stats.push(cost)
    }

    // Drop the widest extras first when the terminal is too narrow for one row
    const room = total - 6
    while (stats.length > 1 && stats.reduce((n, st) => n + width(st) + 4, 0) > room) stats.pop()

    const ctxFull = s.context !== null && s.context.percent >= COMPACT_AT

    return (
      <Box paddingX={1} alignItems="flex-end">
        {clawd}
        <Box flexDirection="column">
          <Text wrap="truncate">{draw(top)}</Text>
          <Box width={total}>
            <Text color={border}>│</Text>
            <Box flexGrow={1} justifyContent="space-between" paddingX={2}>
              {stats.map(st => <Text>{draw(st)}</Text>)}
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
            <Text color={border}>│</Text>
          </Box>
          <Text wrap="truncate">{draw(bottom)}</Text>
        </Box>
      </Box>
    )
  })
}
