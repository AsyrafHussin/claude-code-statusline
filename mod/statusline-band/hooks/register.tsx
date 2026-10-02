import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  BAR_CELLS,
  cleanCommitMessage,
  DEFAULTS,
  WINDOW_MS,
  barCells,
  dayLabel,
  formatDuration,
  formatReset,
  formatTokens,
  formatUsd,
  gitGuide,
  gitDecision,
  looseGitSteps,
  parsePlainGit,
  perHour,
  placeFolder,
  prettyModel,
  readConfig,
  runsOutIn,
  shiftDay,
  shirtText,
  sumDays,
} from './logic'
import type { GitStep } from './logic'
import type { CostLedger, HistoryDay, Limit, Mood, PaceLog, Snapshot, TokenLedger } from '../types'

const snap = atom({ plugin: 'statusline-band', key: 'snap' } as const, null)
const isCompacting = atom({ plugin: 'statusline-band', key: 'isCompacting' } as const, false)
const frame = atom({ plugin: 'statusline-band', key: 'frame' } as const, 0)
const isBlinking = atom({ plugin: 'statusline-band', key: 'isBlinking' } as const, false)
const lastTurn = atom({ plugin: 'statusline-band', key: 'lastTurn' } as const, null)
const history = atom({ plugin: 'statusline-band', key: 'history' } as const, [])
const mood = atom({ plugin: 'statusline-band', key: 'mood' } as const, 'idle')
const moodTick = atom({ plugin: 'statusline-band', key: 'moodTick' } as const, 0)

const LIMIT_LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }
const RINGS = ['○', '◔', '◑', '◕', '●']
// The recent pace: readings kept every 5 minutes over the last 3 hours, read once they span 30 minutes
const PACE_KEY = 'pace-v1'
const PACE_SAMPLE_MS = 5 * 60_000
const PACE_LOOKBACK_MS = 3 * 3_600_000
const PACE_MIN_SPAN_MS = 30 * 60_000
const ALERT_THRESHOLDS = [80, 95]
const COMPACT_AT = 80
const LEDGER_DAYS = 62
// The pane with each day's cost and tokens, opened by /usage-history or the "30d" label
const HISTORY_PANE = 'usage-history'
// Buttons under the card: most send a prompt as if typed (while Claude works it waits its turn);
// quick commit runs itself, with the small model writing the message
// A prompt to send, or (quick commit) none: that one runs itself
type Action = { key: string; label: string; hotkey: string; prompt?: string }
const ACTIONS: Action[] = [
  {
    key: 'push',
    label: 'push',
    hotkey: '1',
    prompt: 'Commit any uncommitted changes with a clear message, then push the current branch.',
  },
  {
    key: 'bugs',
    label: 'find bugs',
    hotkey: '2',
    prompt:
      'Review the uncommitted changes and the commits not yet pushed in this repo for bugs. Verify each one before reporting it, and list them before fixing anything.',
  },
  {
    key: 'test',
    label: 'run tests',
    hotkey: '3',
    prompt: "Run this project's tests, typecheck and linters, and report what fails.",
  },
  {
    key: 'summary',
    label: 'summarize',
    hotkey: '4',
    prompt: 'Summarize what we changed in this session in a few short lines.',
  },
  {
    key: 'quick-commit',
    label: 'quick commit',
    hotkey: '5',
  },
]
const HISTORY_BAR = 30
const LEDGER_SESSIONS = 100
// v2: the first ledger counted a resumed session's whole past cost as today's
const COST_KEY = 'costs-v2'
// Tokens are counted by the mod at each turn's end, so they start from when it was installed
const TOKEN_KEY = 'tokens-v1'
// Per repo, by its root: whether Claude may commit, and push, without asking
const GIT_AUTO_KEY = 'git-auto-v1'
type GitAuto = Record<GitStep, boolean>
const REVIEW: GitAuto = { commit: false, push: false }
const GIT_TIMEOUT = { timeoutMs: 5000 }
// Clawd, the Claude Code mascot, beside the panel in a shirt with the owner's initials:
// standing when idle, running while Claude works (arms and legs trade places each step,
// dust kicked up behind)
const CLAWD_COLOR = '#d97757'
const DUST_COLOR = '#78716c'
const SHIRT_COLOR = '#2563eb'
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
// Clawd's moods while Claude is not working: cheering just after a push, asleep after a quiet
// spell, sweating while a rate limit is nearly used up
const MOOD_TICK_MS = 800
const CHEER_MS = 3500
const SLEEP_AFTER_MS = 10 * 60_000
const SWEAT_AT = 95
const SWEAT_COLOR = '#60a5fa'
const SPARK_COLOR = '#fde047'
const SLEEP_COLOR = '#a1a1aa'
const CLAWD_CHEER = [
  { arms: ['▘', '▝'], legs: '  ▘▘ ▝▝  ' },
  { arms: ['▘', '▝'], legs: ' ▘ ▘ ▝ ▝ ' },
]
// Room left for the band's own collapse mark ([-], three columns) on the right, with one to spare
const ENGINE_MARK_WIDTH = 4
const RUNNER_TICK_MS = 120
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
}

// What each person sets for themselves in /config (the manifest's userConfig); read in register,
// so a change there reloads the module with the new values
let config = DEFAULTS

const toneHex = (pct: number) => (pct >= 80 ? COLORS.hot : pct >= 50 ? COLORS.warn : COLORS.ok)
const ring = (pct: number) => RINGS[Math.min(4, Math.round((pct / 100) * 4))]

let isRefreshing = false
let runner: { cancel: () => void } | null = null
let hasTimers = false
// When the person last did something, and until when Clawd cheers; both start over on a reload
let lastActiveAt: number | null = null
let cheerUntil = 0
// Uncommitted files when the turn began, so its end can tell whether the turn changed any
let changedAtStart = 0
// The permission mode, as the last prompt carried it: under bypass the band asks only where a switch says ask
let permissionMode: string | undefined

// The refresh and blink timers, started in session.start so they outlive any one event.
// The other hooks call it too, for a hot reload, which starts the module over without one
function startTimers($: EngineInterface) {
  if (hasTimers) return
  hasTimers = true
  $.clock.every(30_000, () => void refresh($))
  $.clock.every(MOOD_TICK_MS, () => void tickMood($))
  $.clock.every(BLINK_EVERY_MS, () => {
    void update($, isBlinking, () => true)
    $.clock.after(BLINK_FOR_MS, () => void update($, isBlinking, () => false))
  })
}

// Picks Clawd's mood and, while it has one, steps its animation
async function tickMood($: EngineInterface) {
  const now = await $.clock.now()
  lastActiveAt ??= now
  const s = await read($, snap)
  const highest = Math.max(0, ...(s?.limits ?? []).map(l => l.percent))
  const next: Mood =
    now < cheerUntil ? 'cheer' : now - lastActiveAt > SLEEP_AFTER_MS ? 'sleep' : highest >= SWEAT_AT ? 'sweat' : 'idle'
  if (next !== (await read($, mood))) await update($, mood, () => next)
  if (next !== 'idle') await update($, moodTick, n => n + 1)
}

async function markActive($: EngineInterface) {
  lastActiveAt = await $.clock.now()
  if ((await read($, mood)) === 'sleep') await update($, mood, () => 'idle')
}

const readAllGitAuto = async ($: EngineInterface) =>
  ((await $.store.get(GIT_AUTO_KEY)) as Record<string, GitAuto> | undefined) ?? {}

async function readGitAuto($: EngineInterface, root: string): Promise<GitAuto> {
  return { ...REVIEW, ...(await readAllGitAuto($))[root] }
}

// Flips one switch, auto or ask, for the repo the session is in, and redraws the band with it
async function toggleGitAuto($: EngineInterface, step: GitStep) {
  const s = await read($, snap)
  const root = s?.git?.root
  if (!s || !root) return
  // Read again right before the write, so a switch flipped elsewhere meanwhile is kept
  const all = await readAllGitAuto($)
  const next = { ...REVIEW, ...all[root], [step]: !(all[root]?.[step] ?? false) }
  await $.store.set(GIT_AUTO_KEY, { ...all, [root]: next })
  await update($, snap, was => (was ? { ...was, gitAuto: next } : was))
}

// What a git step is about to take with it, for the line under its dialog:
// "✎ 2 files +12 −4" for a commit, "↑ 3 commits +518 −20 to origin/main" for a push
async function pendingSummary($: EngineInterface, root: string, steps: GitStep[]) {
  const git = (...args: string[]) => $.process.run(['git', '-C', root, ...args], GIT_TIMEOUT).catch(() => null)
  const lines = (stat: string) => {
    const added = /(\d+) insertion/.exec(stat)?.[1]
    const removed = /(\d+) deletion/.exec(stat)?.[1]
    return `${added ? ` +${added}` : ''}${removed ? ` −${removed}` : ''}`
  }
  const parts: string[] = []
  if (steps.includes('commit')) {
    const [status, diff] = await Promise.all([git('status', '--porcelain'), git('diff', '--shortstat', 'HEAD')])
    const files = (status?.stdout ?? '').split('\n').filter(row => row.trim() !== '').length
    if (files > 0) parts.push(`✎ ${files} ${files === 1 ? 'file' : 'files'}${lines(diff?.stdout ?? '')}`)
  }
  if (steps.includes('push')) {
    const [upstream, count, diff] = await Promise.all([
      git('rev-parse', '--abbrev-ref', '@{upstream}'),
      git('rev-list', '--count', '@{upstream}..HEAD'),
      git('diff', '--shortstat', '@{upstream}...HEAD'),
    ])
    const ahead = Number(count?.stdout.trim() ?? 0)
    if (upstream?.exitCode === 0 && ahead > 0) {
      parts.push(`↑ ${ahead} ${ahead === 1 ? 'commit' : 'commits'}${lines(diff?.stdout ?? '')} to ${upstream.stdout.trim()}`)
    } else if (upstream?.exitCode !== 0) {
      parts.push('↑ a branch with no upstream yet')
    }
  }
  return parts.join(' · ')
}

// Commits everything in the session's repo with a message the small model writes from the diff, after
// the person reads it: commit, commit and push, or type their own. It runs git itself, on that press,
// so it costs the main model nothing
async function quickCommit($: EngineInterface) {
  const root = (await read($, snap))?.git?.root
  if (!root) {
    $.ui.toast('Not in a git repo')
    return
  }
  const git = (...args: string[]) => $.process.run(['git', '-C', root, ...args], { timeoutMs: 30_000 })
  const status = await git('status', '--porcelain')
  const files = status.stdout.split('\n').filter(row => row.trim() !== '')
  if (files.length === 0) {
    $.ui.toast('Nothing to commit')
    return
  }
  $.ui.toast('✎  Writing a commit message…')
  const [diff, log] = await Promise.all([git('diff', 'HEAD'), git('log', '-5', '--format=%s')])
  const untracked = files.filter(row => row.startsWith('??')).map(row => row.slice(3))
  const written = await $.model.complete({
    model: 'haiku',
    maxTokens: 400,
    system:
      'You write git commit messages. Reply with the message alone: a subject line under 72 characters in the style of the recent subjects, a blank line, then a short body saying what changed and why. No code fences, no quotes, no apostrophes, and no line crediting anyone.',
    prompt: [
      `Recent subjects:\n${log.stdout.trim()}`,
      untracked.length > 0 ? `New files:\n${untracked.join('\n')}` : '',
      `Diff:\n${diff.stdout.slice(0, 24_000)}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  })
  if (!written.isAnswered) {
    $.ui.toast(`Could not write a message (${written.reason})`)
    return
  }
  const proposed = cleanCommitMessage(written.text)
  const COMMIT = 'Commit'
  const PUSH = 'Commit and push'
  const CANCEL = 'Cancel'
  const answer = await $.ui
    .ask(`Commit ${files.length} ${files.length === 1 ? 'file' : 'files'} with this message? (or type your own)\n\n${proposed}`, {
      options: [COMMIT, PUSH, CANCEL],
      header: 'Commit',
    })
    .catch(() => CANCEL)
  if (answer === CANCEL) return
  const message = answer === COMMIT || answer === PUSH ? proposed : cleanCommitMessage(answer)
  if (!message) return
  const added = await git('add', '-A')
  const committed = added.exitCode === 0 ? await git('commit', '-q', '-m', message) : added
  if (committed.exitCode !== 0) {
    $.ui.toast(`Commit failed: ${(committed.stderr || committed.stdout).trim().split('\n')[0] ?? ''}`)
    return
  }
  if (answer === PUSH) {
    const pushed = await git('push')
    $.ui.toast(pushed.exitCode === 0 ? '✓  Committed and pushed' : `Committed, but the push failed: ${pushed.stderr.trim().split('\n')[0] ?? ''}`)
  } else {
    $.ui.toast('✓  Committed')
  }
  void refresh($)
}

// After a turn that changed files, offers "commit and push" in the empty prompt box, for Tab to take
async function suggestAfterTurn($: EngineInterface) {
  await refresh($)
  const changed = (await read($, snap))?.git?.changed ?? 0
  if (changed > 0 && changed !== changedAtStart) await $.prompt.suggest({ text: 'commit and push' }).catch(() => undefined)
}

// The root of the repo a folder is in, or null outside one
async function repoRoot($: EngineInterface, dir: string) {
  const top = await $.process.run(['git', '-C', dir, 'rev-parse', '--show-toplevel'], GIT_TIMEOUT).catch(() => null)
  return top?.exitCode === 0 ? top.stdout.trim() : null
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
    repoRoot($, cwd),
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
    root: top,
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
  // Re-inserted so the session moves to the back and is not the first pruned while it still runs;
  // pruned, a session started today would count all it spent again
  delete ledger.sessions[sessionId]
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
  // Re-inserted so a running session moves to the back and is not pruned first
  const counted = (ledger.sessions[sessionId] ?? 0) + tokens
  delete ledger.sessions[sessionId]
  ledger.sessions[sessionId] = counted
  const days = Object.keys(ledger.days).sort()
  for (const old of days.slice(0, Math.max(0, days.length - LEDGER_DAYS))) delete ledger.days[old]
  const sessions = Object.keys(ledger.sessions)
  for (const old of sessions.slice(0, Math.max(0, sessions.length - LEDGER_SESSIONS))) delete ledger.sessions[old]
  await $.store.set(TOKEN_KEY, ledger)
}

// Gathers each of the last 30 days' cost and tokens from the ledgers, then opens the pane
async function openHistory($: EngineInterface) {
  const [costs, tokens, clock] = await Promise.all([
    $.store.get(COST_KEY) as Promise<CostLedger | undefined>,
    $.store.get(TOKEN_KEY) as Promise<TokenLedger | undefined>,
    $.process.run(['date', '+%Y-%m-%d']),
  ])
  const today = clock.stdout.trim()
  const days = Array.from({ length: config.rollingDays }, (_, i) => shiftDay(today, i - (config.rollingDays - 1)))
  await update($, history, () => days.map(day => ({ day, usd: costs?.days[day] ?? 0, tokens: tokens?.days[day] ?? 0 })))
  await $.ui.open({ id: HISTORY_PANE, title: `Usage, last ${config.rollingDays} days` })
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
async function alertLimits($: EngineInterface, limits: Limit[], now: number) {
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
  // And once per window when its pace would use it up before the reset
  for (const l of limits) {
    if (!l.resetsAt) continue
    const resetMs = Date.parse(l.resetsAt) - now
    const out = runsOutIn(l.kind, l.percent, resetMs, l.recentRate)
    const id = `pace@${l.kind}@${l.resetsAt}`
    if (out === undefined || alerted.includes(id)) continue
    fresh.push(id)
    const name = LIMIT_LABELS[l.kind] ?? l.kind
    $.ui.toast(`▲  ${name} limit runs out in ~${formatReset(out)} at this pace, ${formatReset(resetMs - out)} before it resets`, {
      timeoutMs: 10_000,
    })
  }
  if (fresh.length > 0) await $.store.set('alerted', [...alerted, ...fresh].slice(-50))
}

// The reset moment in the machine's own timezone: "11:10 AM" within a day, else "Sat 8:00 PM"
async function localResetTime($: EngineInterface, iso: string, now: number) {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return undefined
  const format = ms - now < 86_400_000 ? '+%-I:%M %p' : '+%a %-I:%M %p'
  const epoch = String(Math.floor(ms / 1000))
  // BSD date (macOS) takes the epoch with -r; GNU date (Linux) reads -r as a file and takes -d @epoch
  const bsd = await $.process.run(['date', '-r', epoch, format])
  if (bsd.exitCode === 0) return bsd.stdout.trim()
  const gnu = await $.process.run(['date', '-d', `@${epoch}`, format])
  return gnu.exitCode === 0 ? gnu.stdout.trim() : undefined
}

async function refresh($: EngineInterface) {
  if (isRefreshing) return
  isRefreshing = true
  try {
    const cwd = await $.session.cwd()
    const [usage, model, now, clock, repo, sessionId, agents] = await Promise.all([
      $.session.usage(),
      $.session.model(),
      $.clock.now(),
      $.process.run(['date', '+%Y-%m-%d|%I:%M %p|%H|%M|%S']),
      readGit($, cwd).catch(() => null),
      $.session.id(),
      $.agent.list().catch(() => []),
    ])
    const [day = '', time = '', hh, mm, ss] = clock.stdout.trim().split('|')
    const midnight = now - ((Number(hh) * 60 + Number(mm)) * 60 + Number(ss)) * 1000
    const costUsd = usage.cost?.usd ?? null
    const ledger = costUsd !== null ? await recordCost($, sessionId, costUsd, day, usage.startedAt >= midnight) : null
    const tokenLedger = (await $.store.get(TOKEN_KEY)) as TokenLedger | undefined
    const since = shiftDay(day, -(config.rollingDays - 1))
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

    const next: Omit<Snapshot, 'gitAuto'> = {
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
        rolling: sumDays(tokenLedger?.days ?? {}, since, day),
      },
      rollingUsd: ledger ? sumDays(ledger.days, since, day) : null,
      limits,
      agents: agents.filter(a => a.status === 'running').length,
    }
    // Commits that were waiting to go out and are now pushed: Clawd cheers
    const before = await read($, snap)
    if ((before?.git?.ahead ?? 0) > 0 && repo !== null && repo.hasUpstream && repo.ahead === 0) cheerUntil = now + CHEER_MS
    // The switches are read last, so one flipped while this refresh ran is not drawn back
    const gitAuto = repo?.root ? await readGitAuto($, repo.root) : null
    await update($, snap, () => ({ ...next, gitAuto }))
    await alertLimits($, limits, now)
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

export const register: Register = (on, options) => {
  config = readConfig(options)

  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    startTimers($)
    void refresh($)
    await $.command.register({
      name: HISTORY_PANE,
      description: `Show cost and tokens for each of the last ${config.rollingDays} days`,
    })
    return ran
  })

  on('command.run', { command: HISTORY_PANE }, async $ => {
    await openHistory($)
    return { text: 'Usage history opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: HISTORY_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const days = await read($, history)
    const most = Math.max(0.01, ...days.map(d => d.usd))
    const usd = days.reduce((sum, d) => sum + d.usd, 0)
    const tokens = days.reduce((sum, d) => sum + d.tokens, 0)
    // The newest days when the pane is too short for all of them
    const room = Math.max(1, (e.viewport?.rows ?? 40) - 7)
    // The same table as plain text, for the clipboard
    const asText = [
      ...days.map(d => `${dayLabel(d.day)}  ${formatUsd(d.usd).padStart(7)}  ${(d.tokens > 0 ? formatTokens(d.tokens) : '-').padStart(6)}`),
      `${config.rollingDays} days  ${formatUsd(usd)} · ${formatTokens(tokens)} tokens`,
    ].join('\n')

    return (
      <Box flexDirection="column">
        {days.slice(-room).map(d => {
          const cells = d.usd > 0 ? Math.max(1, Math.round((d.usd / most) * HISTORY_BAR)) : 0
          return (
            <Text key={d.day} wrap="truncate">
              <Text dimColor>{`${dayLabel(d.day)}  `}</Text>
              <Text color={COLORS.ok}>{'█'.repeat(cells)}</Text>
              <Text dimColor>{'·'.repeat(HISTORY_BAR - cells)}</Text>
              <Text color={d.usd > 0 ? COLORS.ok : undefined} dimColor={d.usd === 0}>{`  ${formatUsd(d.usd).padStart(7)}`}</Text>
              <Text color={COLORS.model}>{`  ${(d.tokens > 0 ? formatTokens(d.tokens) : '–').padStart(6)}`}</Text>
            </Text>
          )
        })}
        <Text> </Text>
        <Text wrap="truncate">
          <Text dimColor>{`${config.rollingDays} days  `}</Text>
          <Text color={COLORS.ok} bold>{formatUsd(usd)}</Text>
          <Text dimColor>{' · '}</Text>
          <Text color={COLORS.model}>{formatTokens(tokens)}</Text>
          <Text dimColor>{' tokens, counted from when the mod was installed'}</Text>
        </Text>
        <Text> </Text>
        <Button
          key="copy-history"
          plain
          dimColor
          label="copy as text"
          onPress={press =>
            void $.ui.copy({ text: asText, surface: press.surface }).then(copied =>
              $.ui.toast(copied.isCopied ? '✓  Copied' : 'Could not copy'),
            )
          }
        />
      </Box>
    )
  })

  on('prompt.submit', async ($, e, next) => {
    startTimers($)
    await markActive($)
    changedAtStart = (await read($, snap))?.git?.changed ?? 0
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
    void markActive($)
    const ran = await next(e)
    runner?.cancel()
    runner = null
    const used = ran.usage
    if (used) {
      const input = used.input_tokens + used.cache_read_input_tokens + used.cache_creation_input_tokens
      await update($, lastTurn, () => ({ input, output: used.output_tokens, cached: used.cache_read_input_tokens }))
      const [sessionId, clock] = await Promise.all([$.session.id(), $.process.run(['date', '+%Y-%m-%d'])])
      await recordTokens($, sessionId, clock.stdout.trim(), input + used.output_tokens)
    }
    void suggestAfterTurn($)
    return ran
  })

  on('tool.call', async ($, e, next) => {
    startTimers($)
    void markActive($)
    const ran = await next(e)
    void refresh($)
    return ran
  })

  // With attribution off, the trailer and footer the engine asks Claude to write are empty
  on('attribution.text', async ($, e, next) =>
    config.noAttribution && (e.kind === 'commit' || e.kind === 'pr') ? { text: '' } : next(e),
  )

  // The system prompt learns how git goes in this repo: the plain form, where each switch stands, and no
  // credit lines with attribution off
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const root = (await read($, snap))?.git?.root
    if (!root) return composed
    const text = gitGuide(root, await readGitAuto($, root), config.noAttribution)
    return { sections: [...composed.sections, { id: 'statusline-band:git', text, scope: 'session' as const }] }
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    permissionMode = e.permission_mode
    return next(e)
  })

  // The switches at work. A git add, commit or push asks while its switch is on ask. On auto it runs
  // without a prompt only in its plain form (git -C /path add|commit -m '...'|push, joined by &&); any
  // other shape, a force push among them, asks whatever the switch says
  on('classic.PreToolUse', { tool: 'Bash' }, async ($, e, next) => {
    if (looseGitSteps(e.command).length === 0) return next(e)
    // Everything beneath runs first, your own settings hooks among them, and its ask or deny stands
    const below = await next(e)
    if (below.ask !== undefined || below.deny !== undefined) return below
    const { allow: _allow, ask: _ask, deny: _deny, ...kept } = below
    // Judged as it will run: a hook beneath may have rewritten it
    const rewritten = below.updatedInput?.command
    const command = typeof rewritten === 'string' ? rewritten : e.command
    const plain = parsePlainGit(command)
    const loose = looseGitSteps(command)
    const cwd = await $.session.cwd()
    const root = await repoRoot($, plain?.dir ?? cwd)
    const auto = plain !== null && root !== null ? await readGitAuto($, root) : REVIEW
    const decision = gitDecision(plain, loose, auto)
    if (decision === 'pass') return below
    // Under bypass, the person chose no prompts: only a switch they set to ask still asks
    if (decision === 'ask' && permissionMode === 'bypassPermissions') {
      const repoAuto = root !== null ? await readGitAuto($, root) : REVIEW
      if ((plain?.steps ?? loose).every(step => repoAuto[step])) return below
    }
    if (decision === 'allow') return { ...kept, allow: true }
    // Under the dialog: what this step takes with it
    if (root !== null) {
      const summary = await pendingSummary($, root, plain?.steps ?? loose)
      if (summary) $.ui.notice(e.tool_use_id, summary)
    }
    const name = root?.split('/').filter(Boolean).pop() ?? 'this repo'
    if (plain === null) {
      return { ...kept, ask: `Confirm this git step. On auto the band only lets plain git add, commit -m and push through without asking.` }
    }
    const held = plain.steps.filter(step => !auto[step])
    const doing = held.map(step => (step === 'push' ? 'pushing' : 'committing')).join(' and ')
    const switches = held.map(step => `"${step}"`).join(' and ')
    return { ...kept, ask: `${name} asks before ${doing}. Switch ${switches} to auto in the band to skip this.` }
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

    const feeling: Mood = e.props.isWorking ? 'idle' : await read($, mood)
    const beat = await read($, moodTick)
    const border = e.props.isWorking ? COLORS.borderBusy : feeling === 'sweat' ? COLORS.hot : COLORS.border
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
      const addTotal = (usd: number, n: number) =>
        cost.push({ text: ' · ', dim: true }, { text: formatUsd(usd), color: COLORS.ok }, ...tokens(n), { text: ' ' })
      // Today only when it adds to the session; the 30 days always, even while it matches today
      if (s.todayUsd !== null && s.todayUsd - s.costUsd >= 0.01) {
        addTotal(s.todayUsd, counted.today)
        cost.push({ text: 'today', dim: true })
      }
      // The 30 days' label is a button that opens the history pane, so it is drawn apart
      if (s.rollingUsd !== null) addTotal(s.rollingUsd, counted.rolling)
    }
    const historyLabel = `${config.rollingDays}d`
    const hasHistory = s.costUsd !== null && s.rollingUsd !== null
    const costWidth = width(cost) + (hasHistory ? historyLabel.length : 0) + 1
    // When the whole line does not fit beside the title, the session cost alone still shows
    const fits = (n: number) => width(title) + n + 3 <= total
    const showFull = cost.length > 0 && fits(costWidth)
    const right = showFull ? cost : fits(width(costShort)) ? costShort : []
    const rightWidth = showFull ? costWidth : width(right)
    const topLeft = [...title, line('─'.repeat(Math.max(1, total - width(title) - rightWidth - 2))), ...right]
    const topRight = [...(showFull ? [{ text: ' ' }] : []), line('─╮')]

    // Bottom edge: the git groups on the left; the last turn's tokens, how long the session has run and the time on the right
    // Subagents running right now come first, ahead of git
    const running = (s.agents as number | undefined) ?? 0
    const groups: Seg[][] = [
      ...(running > 0 ? [[{ text: `↻ ${running} ${running === 1 ? 'agent' : 'agents'}`, color: COLORS.model }]] : []),
      ...gitGroups,
    ]
    const changes: Seg[] =
      groups.length === 0 ? [] : [{ text: ' ' }, ...groups.flatMap((group, i) => (i === 0 ? group : [sep, ...group])), { text: ' ' }]
    const clock: Seg[] = [
      { text: ' ' },
      // The last turn's tokens, its responses summed: read in (cache included) and written out
      ...(turn
        ? [
            { text: 'in ', dim: true },
            { text: formatTokens(turn.input), color: COLORS.model },
            ...(turn.input > 0 && turn.cached !== undefined
              ? [{ text: ` (${Math.floor((turn.cached / turn.input) * 100)}% cache)`, dim: true }]
              : []),
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
    const pose =
      tick !== null
        ? CLAWD_RUN[step % CLAWD_RUN.length] ?? CLAWD_IDLE
        : feeling === 'cheer'
          ? CLAWD_CHEER[beat % CLAWD_CHEER.length] ?? CLAWD_IDLE
          : CLAWD_IDLE
    const dust = tick === null ? null : DUST[step % DUST.length]
    const blink = tick === null && (feeling === 'sleep' || (await read($, isBlinking)))
    // The two columns left of Clawd: dust while running, else a falling drop (an emoji, two wide), z's or
    // sparkles by mood
    const side: [string, string][] =
      feeling === 'sweat'
        ? [0, 1, 2].map(row => [row === beat % 3 ? '💧' : '  ', SWEAT_COLOR])
        : feeling === 'sleep'
          ? beat % 2 === 0
            ? [[' Z', SLEEP_COLOR], ['z ', SLEEP_COLOR], ['  ', SLEEP_COLOR]]
            : [['Z ', SLEEP_COLOR], [' z', SLEEP_COLOR], ['  ', SLEEP_COLOR]]
          : feeling === 'cheer'
            ? beat % 2 === 0
              ? [['✦ ', SPARK_COLOR], ['  ', SPARK_COLOR], [' ✧', SPARK_COLOR]]
              : [[' ✧', SPARK_COLOR], ['✦ ', SPARK_COLOR], ['  ', SPARK_COLOR]]
            : [0, 1, 2].map(row => [dust?.[row] ?? '  ', DUST_COLOR])
    const puff = (row: number) => <Text color={side[row]?.[1]}>{side[row]?.[0] ?? '  '}</Text>
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
          <Text backgroundColor={SHIRT_COLOR} color="#ffffff" bold>{shirtText(config.initials)}</Text>
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
    // A limit's card, shown while the pointer is over it: the pace across the window and lately
    const paceCard = (l: Limit, resetMs: number, out: number | undefined): Seg[] | undefined => {
      const windowMs = WINDOW_MS[l.kind]
      const elapsed = windowMs === undefined ? 0 : windowMs - resetMs
      if (elapsed <= 0) return undefined
      return [
        { text: ' pace ', dim: true },
        { text: perHour(l.percent / elapsed) },
        { text: ' this window', dim: true },
        { text: ' · ', dim: true },
        ...(l.recentRate !== undefined
          ? [{ text: perHour(l.recentRate) }, { text: ' last 3h', dim: true }]
          : [{ text: 'last 3h not read yet', dim: true }]),
        ...(out !== undefined
          ? [{ text: ` → out ~${formatReset(out)}, ${formatReset(resetMs - out)} before reset `, color: COLORS.hot }]
          : [{ text: ' → lasts until reset ', color: COLORS.ok }]),
      ]
    }
    type Block = { key: string; segs: Seg[]; card?: Seg[] }
    const stats: Block[] = [
      ...s.limits.map((l): Block => {
        const resetMs = l.resetsAt ? Date.parse(l.resetsAt) - s.now : 0
        const name = LIMIT_LABELS[l.kind] ?? l.kind
        if (resetMs <= 0) return { key: l.kind, segs: stat(l.percent, name) }
        const out = runsOutIn(l.kind, l.percent, resetMs, l.recentRate)
        const segs = stat(l.percent, `${name} · reset ${formatReset(resetMs)}`, [
          ...(l.resetsOn ? [{ text: ` (${l.resetsOn})`, dim: true }] : []),
          ...(out !== undefined ? [{ text: ` ▲ out ~${formatReset(out)}`, color: COLORS.hot, bold: true }] : []),
        ])
        return { key: l.kind, segs, card: paceCard(l, resetMs, out) }
      }),
      ...(s.context
        ? [
            { key: 'ctx', segs: [
              { text: 'ctx ', dim: true },
              { text: '━'.repeat(barCells(s.context.percent)), color: toneHex(s.context.percent) },
              { text: '━'.repeat(BAR_CELLS - barCells(s.context.percent)), dim: true },
              {
                text: ` ${Math.round(s.context.percent)}%`,
                bold: true,
                color: s.context.percent >= 50 ? toneHex(s.context.percent) : undefined,
              },
              { text: ` ${formatTokens(s.context.tokens)}/${formatTokens(s.context.window)}`, dim: true },
            ] },
          ]
        : []),
    ]

    // Drop the last blocks first when the terminal is too narrow for one row
    const divider: Seg = { text: '   │   ', color: border }
    const room = total - 8
    while (stats.length > 1 && stats.reduce((n, st) => n + width(st.segs) + width([divider]), 0) > room) stats.pop()

    const ctxFull = s.context !== null && s.context.percent >= COMPACT_AT
    // A snapshot kept from before a reload may predate the ticks
    const gitAuto = (s.gitAuto as GitAuto | null | undefined) ?? null
    // A side of the frame, one "│" per row of the stats and their padding
    const edge = (side: string) => (
      <Box flexDirection="column">
        {Array.from({ length: config.padRows * 2 + 1 }, (_, i) => (
          <Text key={`${side}${i}`} wrap="truncate">{draw([line('│')])}</Text>
        ))}
      </Box>
    )

    return (
      // The whole band on the card color, Clawd and the actions included; its own edge columns are padding
      <Box paddingX={1} paddingY={1} flexDirection="column" backgroundColor={config.card || undefined}>
        <Box alignItems="center">
          {clawd}
          {/* The card's own edge columns are painted over below its first row, so the frame sits one in */}
          <Box flexDirection="column" backgroundColor={config.card || undefined} paddingX={CARD_INSET}>
            <Box>
              <Text wrap="truncate">{draw(topLeft)}</Text>
              {showFull && hasHistory && (
                <Button key="history" plain dimColor label={historyLabel} onPress={() => void openHistory($)} />
              )}
              <Text wrap="truncate">{draw(topRight)}</Text>
            </Box>
            <Box width={total}>
              {edge('l')}
              <Box flexGrow={1} paddingX={2} paddingY={config.padRows} justifyContent="space-between">
                <Box>
                  {stats.flatMap((st, i) => [
                    ...(i === 0 ? [] : [<Text key={`div-${st.key}`} wrap="truncate">{draw([divider])}</Text>]),
                    <Box key={`stat-${st.key}`}>
                      <Text wrap="truncate">{draw(st.segs)}</Text>
                      {st.card && (
                        <Box
                          position="absolute"
                          top={1}
                          left={0}
                          display="none"
                          hover={{ display: 'flex' }}
                          backgroundColor={config.card || undefined}
                        >
                          <Text wrap="truncate">{draw(st.card)}</Text>
                        </Box>
                      )}
                    </Box>,
                  ])}
                </Box>
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
        {/* Drawn plain, as the band's own dim text: "1: push · 2: find bugs · ...", the repo's ticks on the right */}
        <Box marginLeft={CLAWD_WIDTH + CARD_INSET + 3} width={total - 4} justifyContent="space-between">
          <Box>
          {ACTIONS.flatMap((action, i) => [
            ...(i === 0 ? [] : [<Text key={`sep-${action.key}`} dimColor>{' · '}</Text>]),
            <Button
              key={`action-${action.key}`}
              plain
              dimColor
              label={action.label}
              hotkey={action.hotkey}
              onPress={() =>
                void (action.prompt === undefined ? quickCommit($) : $.prompt.submit({ text: action.prompt, asUser: true }))
              }
            />,
          ])}
          </Box>
          {/* The repo's state, as words: "commit auto · push ask"; the label toggles, the word says which */}
          {gitAuto && (
            <Box>
              {(['commit', 'push'] as const).flatMap((step, i) => [
                ...(i === 0 ? [] : [<Text key={`tick-sep-${step}`} dimColor>{' · '}</Text>]),
                <Button
                  key={`tick-${step}`}
                  plain
                  dimColor
                  label={step}
                  onPress={() => void toggleGitAuto($, step)}
                />,
                <Text key={`tick-state-${step}`} color={gitAuto[step] ? COLORS.ok : COLORS.warn}>
                  {gitAuto[step] ? ' auto' : ' ask'}
                </Text>,
              ])}
            </Box>
          )}
        </Box>
      </Box>
    )
  })
}
