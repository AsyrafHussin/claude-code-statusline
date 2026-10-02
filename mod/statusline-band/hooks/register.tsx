// The hooks module: reads the person's settings and wires the band to the engine's events. The engine
// follows $ only within this file, so everything that touches it lives here, in sections; the pure parts
// live beside it: logic (tested), state (shared values), band and pane (the drawings)
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { drawBand } from './band'
import { BEATBOT_SLEEP_MS } from './layout'
import type { MusicCommand } from './band'
import type { Action } from './band'
import {
  aliasSteps,
  cleanCommitMessage,
  formatReset,
  gitDecision,
  gitGuide,
  isSensitivePath,
  looseGitSteps,
  parsePlainGit,
  parseShortstat,
  addPlayed,
  basicAuth,
  parseSearch,
  safeTrackUri,
  parseSpotify,
  parseStatusV2,
  placeFolder,
  planLabel,
  prettyModel,
  readConfig,
  runsOutIn,
  shiftDay,
  sumDays,
} from './logic'
import type { FoundTrack, GitStep, PlayedTrack } from './logic'
import { drawHistoryPane, drawSearchPane, historyText } from './pane'
import { GIT_TIMEOUT, LIMIT_LABELS, REVIEW, runtime } from './state'
import type { GitAuto } from './state'
import type { CostLedger, Limit, Mood, PaceLog, Snapshot, SpotifySearch, TokenLedger } from '../types'

// ── State values the band draws from

const snap = atom({ plugin: 'statusline-band', key: 'snap' } as const, null)
const isCompacting = atom({ plugin: 'statusline-band', key: 'isCompacting' } as const, false)
const frame = atom({ plugin: 'statusline-band', key: 'frame' } as const, 0)
const isBlinking = atom({ plugin: 'statusline-band', key: 'isBlinking' } as const, false)
const lastTurn = atom({ plugin: 'statusline-band', key: 'lastTurn' } as const, null)
const history = atom({ plugin: 'statusline-band', key: 'history' } as const, [])
const mood = atom({ plugin: 'statusline-band', key: 'mood' } as const, 'idle')
const moodTick = atom({ plugin: 'statusline-band', key: 'moodTick' } as const, 0)
const music = atom({ plugin: 'statusline-band', key: 'music' } as const, null)
const danceTick = atom({ plugin: 'statusline-band', key: 'danceTick' } as const, 0)
const musicCompact = atom({ plugin: 'statusline-band', key: 'musicCompact' } as const, false)
const cardCompact = atom({ plugin: 'statusline-band', key: 'cardCompact' } as const, false)
const search = atom({ plugin: 'statusline-band', key: 'search' } as const, { query: '', status: 'idle', message: '', tracks: [] })

// The pane with each day's cost and tokens, opened by /usage-history or the window's label on the band;
// a literal, so the engine's scan can read the hooks' matchers
const HISTORY_PANE = 'usage-history'
// The Spotify search dialog, opened by the search button or /spotify-search
const SEARCH_PANE = 'spotify-search'

// ── Actions under the card

const ACTIONS: Action[] = [
  {
    key: 'push',
    label: 'push',
    prompt: 'Commit any uncommitted changes with a clear message, then push the current branch.',
  },
  {
    key: 'bugs',
    label: 'find bugs',
    prompt:
      'Review the uncommitted changes and the commits not yet pushed in this repo for bugs; if there are none, review the last few commits instead. Verify each one before reporting it, and list them before fixing anything.',
  },
  {
    key: 'test',
    label: 'run tests',
    prompt: "Run this project's tests, typecheck and linters, and report what fails.",
  },
  {
    key: 'summary',
    label: 'summarize',
    prompt: 'Summarize what we changed in this session in a few short lines.',
  },
  { key: 'quick-commit', label: 'quick commit' },
]

// ── Usage kept across sessions: cost and tokens, the limits' recent pace, toasts shown, reset times

const LEDGER_DAYS = 62
const LEDGER_SESSIONS = 100
// v2: the first ledger counted a resumed session's whole past cost as today's
const COST_KEY = 'costs-v2'
// Tokens are counted by the mod at each turn's end, so they start from when it was installed
const TOKEN_KEY = 'tokens-v1'
const ALERTED_KEY = 'alerted'
const ALERT_THRESHOLDS = [80, 95]
// The recent pace: readings kept every 5 minutes over the last 3 hours, read once they span 30 minutes
const PACE_KEY = 'pace-v1'
const PACE_SAMPLE_MS = 5 * 60_000
const PACE_LOOKBACK_MS = 3 * 3_600_000
const PACE_MIN_SPAN_MS = 30 * 60_000

type Ledger = { days: Record<string, number>; sessions: Record<string, number> }

// Sets a session's figure as the newest, so a session still running is never the first pruned, and keeps
// the last 62 days and the last 100 sessions
const settle = (ledger: Ledger, sessionId: string, value: number) => {
  delete ledger.sessions[sessionId]
  ledger.sessions[sessionId] = value
  const days = Object.keys(ledger.days).sort()
  for (const old of days.slice(0, Math.max(0, days.length - LEDGER_DAYS))) delete ledger.days[old]
  const sessions = Object.keys(ledger.sessions)
  for (const old of sessions.slice(0, Math.max(0, sessions.length - LEDGER_SESSIONS))) delete ledger.sessions[old]
}

// Adds what this session spent since its last reading to today's total. A session first seen after it
// began before today (a resume, one open overnight) counts from that reading on, since what it spent
// earlier is not today's
async function recordCost($: EngineInterface, sessionId: string, usd: number, day: string, isFromToday: boolean) {
  const ledger = ((await $.store.get(COST_KEY)) as CostLedger | undefined) ?? { days: {}, sessions: {} }
  const last = ledger.sessions[sessionId]
  if (last === undefined && !isFromToday) {
    settle(ledger, sessionId, usd)
    await $.store.set(COST_KEY, ledger)
    return ledger
  }
  const delta = usd - (last ?? 0)
  if (delta <= 0) return ledger
  ledger.days[day] = (ledger.days[day] ?? 0) + delta
  settle(ledger, sessionId, usd)
  await $.store.set(COST_KEY, ledger)
  return ledger
}

// Adds a turn's tokens to its session's and today's totals
async function recordTokens($: EngineInterface, sessionId: string, day: string, tokens: number) {
  const ledger = ((await $.store.get(TOKEN_KEY)) as TokenLedger | undefined) ?? { days: {}, sessions: {} }
  ledger.days[day] = (ledger.days[day] ?? 0) + tokens
  settle(ledger, sessionId, (ledger.sessions[sessionId] ?? 0) + tokens)
  await $.store.set(TOKEN_KEY, ledger)
}

const readTokens = async ($: EngineInterface) => (await $.store.get(TOKEN_KEY)) as TokenLedger | undefined

// Gathers each day's cost and tokens over the history window from the ledgers, then opens the pane
async function openHistory($: EngineInterface, today: string) {
  const [costs, tokens] = await Promise.all([$.store.get(COST_KEY) as Promise<CostLedger | undefined>, readTokens($)])
  const span = runtime.config.rollingDays
  const days = Array.from({ length: span }, (_, i) => shiftDay(today, i - (span - 1)))
  await update($, history, () => days.map(day => ({ day, usd: costs?.days[day] ?? 0, tokens: tokens?.days[day] ?? 0 })))
  await $.ui.open({ id: HISTORY_PANE, title: `Usage, last ${span} days` })
}

// Keeps a reading of each window every few minutes, across sessions, and gives each window's recent pace
// in percent per millisecond: from the oldest reading in the lookback to now
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

// Toasts once per window and threshold, even across sessions, and once per window when its pace would
// use it up before the reset
async function alertLimits($: EngineInterface, limits: Limit[], now: number) {
  const alerted = ((await $.store.get(ALERTED_KEY)) as string[] | undefined) ?? []
  const fresh: string[] = []
  for (const l of limits) {
    const name = LIMIT_LABELS[l.kind] ?? l.kind
    const crossed = ALERT_THRESHOLDS.filter(t => l.percent >= t).pop()
    const id = `${l.kind}@${l.resetsAt ?? ''}@${crossed}`
    if (crossed !== undefined && !alerted.includes(id)) {
      fresh.push(id)
      $.ui.toast(`${crossed >= 95 ? '🔥' : '⚠️'}  ${name} limit at ${Math.round(l.percent)}%`, { timeoutMs: 8000 })
    }
    if (!l.resetsAt) continue
    const resetMs = Date.parse(l.resetsAt) - now
    const out = runsOutIn(l.kind, l.percent, resetMs, l.recentRate)
    const paceId = `pace@${l.kind}@${l.resetsAt}`
    if (out === undefined || alerted.includes(paceId)) continue
    fresh.push(paceId)
    $.ui.toast(`▲  ${name} limit runs out in ~${formatReset(out)} at this pace, ${formatReset(resetMs - out)} before it resets`, {
      timeoutMs: 10_000,
    })
  }
  if (fresh.length > 0) await $.store.set(ALERTED_KEY, [...alerted, ...fresh].slice(-50))
}

// The reset moment in the machine's own timezone: "11:10 AM" within a day, else "Sat 8:00 PM". A
// window's reset moment rarely changes, so each is formatted once per load (and format)
const resetTimes = new Map<string, string | undefined>()
async function localResetTime($: EngineInterface, iso: string, now: number) {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return undefined
  const format = ms - now < 86_400_000 ? '+%-I:%M %p' : '+%a %-I:%M %p'
  const key = `${iso}|${format}`
  if (resetTimes.has(key)) return resetTimes.get(key)
  const epoch = String(Math.floor(ms / 1000))
  // BSD date (macOS) takes the epoch with -r; GNU date (Linux) reads -r as a file and takes -d @epoch
  const bsd = await $.process.run(['date', '-r', epoch, format])
  const gnu = bsd.exitCode === 0 ? null : await $.process.run(['date', '-d', `@${epoch}`, format])
  const text = bsd.exitCode === 0 ? bsd.stdout.trim() : gnu?.exitCode === 0 ? gnu.stdout.trim() : undefined
  resetTimes.set(key, text)
  return text
}

// ── Git: the repo as the band shows it, the per-repo switches, the line under a step's dialog

// Per repo, by its root: whether Claude may commit, and push, without asking
const GIT_AUTO_KEY = 'git-auto-v1'

// git in a folder, with its output, or null when it could not run
const runGit = ($: EngineInterface, dir: string, args: string[], timeoutMs = GIT_TIMEOUT.timeoutMs) =>
  $.process.run(['git', '-C', dir, ...args], { timeoutMs }).catch(() => null)

// The root of the repo a folder is in, or null outside one; a folder's root does not change, so each
// is looked up once per load
const roots = new Map<string, string | null>()
async function repoRoot($: EngineInterface, dir: string) {
  const known = roots.get(dir)
  if (known !== undefined) return known
  const top = await runGit($, dir, ['rev-parse', '--show-toplevel'])
  const root = top?.exitCode === 0 ? top.stdout.trim() : null
  // Only a found root is kept: a folder outside a repo may become one
  if (root !== null) roots.set(dir, root)
  return root
}

// The repo as the band shows it, in four git runs: status (branch, upstream, ahead and behind, stashes,
// changed paths), the uncommitted and the unpushed lines, and the time of the last commit
async function readGit($: EngineInterface, cwd: string): Promise<Snapshot['git']> {
  const root = await repoRoot($, cwd)
  if (root === null) return null
  const [status, diff, outgoing, last] = await Promise.all([
    runGit($, cwd, ['status', '--porcelain=v2', '--branch', '--show-stash']),
    runGit($, cwd, ['diff', '--shortstat', 'HEAD']),
    // Fails harmlessly without an upstream
    runGit($, cwd, ['diff', '--shortstat', '@{upstream}...HEAD']),
    runGit($, cwd, ['log', '-1', '--format=%ct']),
  ])
  if (status?.exitCode !== 0) return null
  const state = parseStatusV2(status.stdout)
  if (!state.branch) return null
  const { added, removed } = parseShortstat(diff?.stdout ?? '')
  const unpushed = parseShortstat(outgoing?.exitCode === 0 ? outgoing.stdout : '')
  const committedAt = last?.exitCode === 0 ? Number(last.stdout.trim()) : NaN
  return {
    root,
    branch: state.branch,
    changed: state.changed,
    upstream: state.upstream,
    hasUpstream: state.upstream !== null,
    ahead: state.ahead,
    behind: state.behind,
    added,
    removed,
    unpushedAdded: unpushed.added,
    unpushedRemoved: unpushed.removed,
    stashed: state.stashed,
    lastCommitAt: Number.isFinite(committedAt) && committedAt > 0 ? committedAt * 1000 : null,
  }
}

const readAllGitAuto = async ($: EngineInterface) =>
  ((await $.store.get(GIT_AUTO_KEY)) as Record<string, GitAuto> | undefined) ?? {}

async function readGitAuto($: EngineInterface, root: string): Promise<GitAuto> {
  return { ...REVIEW, ...(await readAllGitAuto($))[root] }
}

// Flips one switch, auto or ask, for the repo the session is in, and redraws the band with it
async function toggleGitAuto($: EngineInterface, step: GitStep) {
  const root = (await read($, snap))?.git?.root
  if (!root) return
  // Read right before the write, so a switch another session flipped meanwhile is kept
  const all = await readAllGitAuto($)
  const next = { ...REVIEW, ...all[root], [step]: !(all[root]?.[step] ?? false) }
  await $.store.set(GIT_AUTO_KEY, { ...all, [root]: next })
  await update($, snap, was => (was ? { ...was, gitAuto: next } : was))
}

// What a git step is about to take with it, for the line under its dialog:
// "✎ 2 files +12 −4" for a commit, "↑ 3 commits +518 −20 to origin/main" for a push
async function pendingSummary($: EngineInterface, root: string, steps: GitStep[]) {
  const git = await readGit($, root)
  if (git === null) return ''
  const lines = (added: number, removed: number) => `${added ? ` +${added}` : ''}${removed ? ` −${removed}` : ''}`
  const parts: string[] = []
  if (steps.includes('commit') && git.changed > 0) {
    parts.push(`✎ ${git.changed} ${git.changed === 1 ? 'file' : 'files'}${lines(git.added, git.removed)}`)
  }
  if (steps.includes('push')) {
    if (git.upstream === null) parts.push('↑ a branch with no upstream yet')
    else if (git.ahead > 0) {
      const commits = `${git.ahead} ${git.ahead === 1 ? 'commit' : 'commits'}`
      parts.push(`↑ ${commits}${lines(git.unpushedAdded, git.unpushedRemoved)} to ${git.upstream}`)
    }
  }
  return parts.join(' · ')
}

// The steps the aliases in a command take, looked up in the repo's git config
async function stepsOfAliases($: EngineInterface, dir: string, aliases: string[]) {
  const found = await Promise.all(
    aliases.map(async alias => {
      const expansion = await runGit($, dir, ['config', '--get', `alias.${alias}`])
      return expansion?.exitCode === 0 ? aliasSteps(expansion.stdout) : []
    }),
  )
  return found.flat()
}

// ── The snapshot: everything the band shows, read in one refresh

const CHEER_MS = 3500

// The Claude plan: the plan setting when set, else Claude Code's own config, of which only the account
// type and tier are read, once per load. Claude Code updates that file when it starts or signs in, so
// an upgrade shows from the next start
async function readPlan($: EngineInterface) {
  if (runtime.config.plan) return runtime.config.plan
  if (runtime.plan !== undefined) return runtime.plan
  const home = await $.env.get('HOME')
  const text = home ? await $.fs.read(`${home}/.claude.json`).catch(() => '') : ''
  runtime.plan = typeof text === 'string' ? planLabel(text) : null
  return runtime.plan
}

async function readAndDraw($: EngineInterface) {
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
  const tokenLedger = await readTokens($)
  const since = shiftDay(day, -(runtime.config.rollingDays - 1))
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
    effort: runtime.effort,
    plan: (await readPlan($)) ?? undefined,
    startedAt: usage.startedAt,
    now,
    day,
    time,
    context: ctx.percent !== undefined ? { percent: ctx.percent, tokens: ctx.tokens ?? 0, window: ctx.window } : null,
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
  if ((before?.git?.ahead ?? 0) > 0 && repo !== null && repo.hasUpstream && repo.ahead === 0) {
    runtime.cheerUntil = now + CHEER_MS
  }
  // The switches are read last, so one flipped while this refresh ran is not drawn back
  const gitAuto = repo?.root ? await readGitAuto($, repo.root) : null
  await update($, snap, () => ({ ...next, gitAuto }))
  await alertLimits($, limits, now)
}

// One refresh at a time. A call while one runs is not dropped: it waits for that one, then runs once
// more (however many calls came meanwhile), so whoever awaits it reads fresh data
let running: Promise<void> | null = null
let queued: Promise<void> | null = null
function refresh($: EngineInterface): Promise<void> {
  if (running === null) {
    running = readAndDraw($)
      .catch(() => undefined)
      .finally(() => {
        running = null
      })
    return running
  }
  queued ??= running.then(() => {
    queued = null
    return refresh($)
  })
  return queued
}

// ── Timers and Clawd's mood

const REFRESH_EVERY_MS = 30_000
const MOOD_TICK_MS = 800
// A mood animates this long, then rests on one frame, so the band is not redrawn every tick for hours
const MOOD_ANIMATE_MS = 60_000
const SLEEP_AFTER_MS = 10 * 60_000
const SWEAT_AT = 95
const BLINK_EVERY_MS = 4_500
const BLINK_FOR_MS = 300

// Picks Clawd's mood and steps the shared beat while a mood animates or Spotify plays.
async function tickMood($: EngineInterface) {
  const now = await $.clock.now()
  runtime.lastActiveAt ??= now
  const s = await read($, snap)
  const highest = Math.max(0, ...(s?.limits ?? []).map(l => l.percent))
  const next: Mood =
    now < runtime.cheerUntil
      ? 'cheer'
      : now - runtime.lastActiveAt > SLEEP_AFTER_MS
        ? 'sleep'
        : highest >= SWEAT_AT
          ? 'sweat'
          : 'idle'
  if (next !== (await read($, mood))) {
    runtime.moodSince = now
    await update($, mood, () => next)
  }
  const spotifyPlaying = runtime.config.spotify && (await read($, music))?.isPlaying
  if (spotifyPlaying || (next !== 'idle' && now - runtime.moodSince < MOOD_ANIMATE_MS)) {
    await update($, moodTick, n => n + 1)
  }
}

async function markActive($: EngineInterface) {
  runtime.lastActiveAt = await $.clock.now()
  if ((await read($, mood)) === 'sleep') await update($, mood, () => 'idle')
}

// The refresh, mood and blink timers, started once per load. Every hook calls it, since a hot reload
// starts the module over without a session.start
let hasTimers = false
function startTimers($: EngineInterface) {
  if (hasTimers) return
  hasTimers = true
  $.clock.every(REFRESH_EVERY_MS, () => void refresh($))
  void $.store.get(CARD_COMPACT_KEY).then(kept => update($, cardCompact, () => kept === true))
  $.clock.every(MOOD_TICK_MS, () => void tickMood($))
  if (runtime.config.spotify) {
    void readSpotify($)
    $.clock.every(SPOTIFY_EVERY_MS, () => void readSpotify($))
    void $.store.get(COMPACT_KEY).then(kept => update($, musicCompact, () => kept === true))
    // Beatbot's dance: a step each tick, only while a track plays
    $.clock.every(DANCE_EVERY_MS, () => void stepDance($))
  }
  $.clock.every(BLINK_EVERY_MS, () => {
    void update($, isBlinking, () => true)
    $.clock.after(BLINK_FOR_MS, () => void update($, isBlinking, () => false))
  })
}

// ── Spotify: what is playing, its album art as pixels, and the controls

const SPOTIFY_EVERY_MS = 5_000
const DANCE_EVERY_MS = 250
const COMPACT_KEY = 'spotify-compact-v1'
const CARD_COMPACT_KEY = 'card-compact-v1'
// Asks only while Spotify runs ("is running" never launches it); fields joined by the unit separator
const SPOTIFY_SCRIPT = `if application "Spotify" is running then
  tell application "Spotify"
    set s to player state as string
    if s is "stopped" then return "stopped"
    set t to current track
    set sep to ASCII character 31
    return s & sep & (name of t) & sep & (artist of t) & sep & (album of t) & sep & (duration of t) & sep & (player position as string) & sep & (artwork url of t) & sep & (id of t) & sep & (shuffling as string) & sep & (repeating as string) & sep & (sound volume as string)
  end tell
end if
return ""`

// Tracks heard, kept across sessions: each is added when the next one starts
const RECENT_KEY = 'spotify-recent-v1'
const RECENT_SHOWN = 3

async function readSpotify($: EngineInterface) {
  const ran = await $.process.run(['osascript', '-e', SPOTIFY_SCRIPT], { timeoutMs: 4000 }).catch(() => null)
  const playing = ran?.exitCode === 0 ? parseSpotify(ran.stdout) : null
  const before = await read($, music)
  if (playing === null) {
    if (before !== null) await update($, music, () => null)
    return
  }
  let recent = before?.recent ?? ((await $.store.get(RECENT_KEY)) as PlayedTrack[] | undefined) ?? []
  // A new track: the one before goes to the top of "recently played"
  if (before !== null && before.trackId !== playing.trackId) {
    recent = addPlayed(recent, { trackId: before.trackId, name: before.name, artist: before.artist, at: await $.clock.now() })
    await $.store.set(RECENT_KEY, recent)
  }
  // When the track was paused, kept while it stays paused (a pause seen at load counts from then)
  const pausedAt = playing.isPlaying ? null : before && !before.isPlaying && before.pausedAt !== null ? before.pausedAt : await $.clock.now()
  await update($, music, () => ({ ...playing, pausedAt, recent: recent.filter(t => t.trackId !== playing.trackId).slice(0, RECENT_SHOWN) }))
}

// Steps only while Beatbot moves and shows: dancing to a track, or asleep with his Z's, and the card not
// minimized, so the band is not redrawn four times a second for nothing
async function stepDance($: EngineInterface) {
  const m = await read($, music)
  if (m === null || (await read($, musicCompact))) return
  const isAsleep = !m.isPlaying && m.pausedAt !== null && (await $.clock.now()) - m.pausedAt >= BEATBOT_SLEEP_MS
  if (m.isPlaying || isAsleep) await update($, danceTick, n => n + 1)
}

// The controls under the band, each one AppleScript line to Spotify; then the state is read again at once
const SPOTIFY_COMMANDS: Record<Exclude<MusicCommand, 'search' | 'compact'>, string> = {
  playpause: 'playpause',
  next: 'next track',
  previous: 'previous track',
  shuffle: 'set shuffling to not shuffling',
  repeat: 'set repeating to not repeating',
  louder: 'set sound volume to ((sound volume) + 10)',
  quieter: 'set sound volume to ((sound volume) - 10)',
  open: 'activate',
}

async function controlSpotify($: EngineInterface, command: MusicCommand) {
  if (command === 'search') {
    await openSearch($)
    return
  }
  // Shrinks the card to one line or brings it back, kept across sessions
  if (command === 'compact') {
    const isCompact = !(await read($, musicCompact))
    await update($, musicCompact, () => isCompact)
    await $.store.set(COMPACT_KEY, isCompact)
    return
  }
  const line = SPOTIFY_COMMANDS[command]
  await $.process.run(['osascript', '-e', `tell application "Spotify" to ${line}`], { timeoutMs: 4000 }).catch(() => null)
  await readSpotify($)
}

// ── Spotify search: the Web API with the app's own credentials (no user sign-in), up to 10 tracks, played
// in the Spotify app through AppleScript

const SEARCH_LIMIT = 10
// The rows the search wants: a gap, heading, the framed box, ten tracks of two lines each, the hint, and gaps
const SEARCH_ROWS = 1 + 1 + 1 + 3 + 1 + SEARCH_LIMIT * 2 + 1 + 2
// The app token, kept until a minute before it expires
let spotifyToken: { value: string; until: number } | null = null

// The app's client secret: the setting when it holds one, else the macOS Keychain item KEYCHAIN_SERVICE,
// since /config leaves out settings marked sensitive. Read once per load
const KEYCHAIN_SERVICE = 'statusline-band-spotify'
let keychainSecret: string | undefined
async function readSpotifySecret($: EngineInterface) {
  if (runtime.config.spotifyClientSecret) return runtime.config.spotifyClientSecret
  if (keychainSecret !== undefined) return keychainSecret
  const found = await $.process
    .run(['security', 'find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], { timeoutMs: 5000 })
    .catch(() => null)
  // Kept only once found, so a secret added after a failed search is read on the next one
  const secret = found?.exitCode === 0 ? found.stdout.trim() : ''
  if (secret) keychainSecret = secret
  return secret || null
}

async function readSpotifyToken($: EngineInterface) {
  const now = await $.clock.now()
  if (spotifyToken && now < spotifyToken.until) return spotifyToken.value
  const id = runtime.config.spotifyClientId
  const secret = await readSpotifySecret($)
  if (!id || !secret) return null
  const got = await $.http
    .fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { Authorization: basicAuth(id, secret), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    })
    .catch(() => null)
  if (!got?.ok) return null
  let body: { access_token?: string; expires_in?: number }
  try {
    body = JSON.parse(got.text) as typeof body
  } catch {
    return null
  }
  if (!body.access_token) return null
  spotifyToken = { value: body.access_token, until: now + ((body.expires_in ?? 3600) - 60) * 1000 }
  return spotifyToken.value
}

async function openSearch($: EngineInterface) {
  const id = runtime.config.spotifyClientId
  const secret = await readSpotifySecret($)
  if (!id || !secret) {
    await update($, search, (): SpotifySearch => ({
      query: '',
      status: 'failed',
      message: !id
        ? 'Set spotifyClientId in /config first (your app at developer.spotify.com/dashboard).'
        : `Add the client secret to the Keychain: security add-generic-password -U -s ${KEYCHAIN_SERVICE} -a client-secret -w`,
      tracks: [],
    }))
  } else {
    // A failure from before, such as missing settings since set, does not greet the next opening
    await update($, search, (state): SpotifySearch => (state.status === 'failed' ? { ...state, status: 'idle', message: '' } : state))
  }
  await $.ui.open({ id: SEARCH_PANE, title: 'Search Spotify', focus: true, closeOnEscape: true, holdToasts: true, rows: SEARCH_ROWS, columns: 72 })
}

async function searchSpotify($: EngineInterface, query: string) {
  const text = query.trim()
  if (!text) return
  await update($, search, (): SpotifySearch => ({ query: text, status: 'searching', message: '', tracks: [] }))
  const token = await readSpotifyToken($)
  if (token === null) {
    await update($, search, (): SpotifySearch => ({
      query: text,
      status: 'failed',
      message: 'Spotify would not give a token: check the client ID in /config and the secret in the Keychain.',
      tracks: [],
    }))
    return
  }
  const url = `https://api.spotify.com/v1/search?type=track&limit=${SEARCH_LIMIT}&q=${encodeURIComponent(text)}`
  const got = await $.http.fetch(url, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null)
  // A token Spotify no longer takes is dropped, so the next search asks for a new one
  if (got?.status === 401) spotifyToken = null
  const tracks = got?.ok ? parseSearch(got.text) : null
  // A newer search typed meanwhile wins: this one's answer is dropped
  if ((await read($, search)).query !== text) return
  await update($, search, (): SpotifySearch =>
    tracks === null
      ? { query: text, status: 'failed', message: `The search failed${got ? ` (${got.status})` : ''}.`, tracks: [] }
      : { query: text, status: 'found', message: '', tracks },
  )
}

// Plays a found track in the Spotify app (launching it if it is not running: the person asked), keeping
// the terminal in front, then closes the dialog and reads the new state
async function playFound($: EngineInterface, track: FoundTrack) {
  const uri = safeTrackUri(track.uri)
  if (uri === null) return
  // play track brings Spotify to the front, so the app that was in front (the terminal) is put back
  await $.process
    .run(
      [
        'osascript',
        '-e', 'set frontApp to path to frontmost application as text',
        '-e', `tell application "Spotify" to play track "${uri}"`,
        '-e', 'delay 0.4',
        '-e', 'tell application frontApp to activate',
      ],
      { timeoutMs: 8000 },
    )
    .catch(() => null)
  await $.ui.close({ id: SEARCH_PANE })
  await readSpotify($)
}

// Shrinks the main card to one line or brings it back, kept across sessions
async function toggleCardCompact($: EngineInterface) {
  const isCompact = !(await read($, cardCompact))
  await update($, cardCompact, () => isCompact)
  await $.store.set(CARD_COMPACT_KEY, isCompact)
}

// ── What the buttons do: quick commit, compact, and the suggestion after a turn

const FILES_SHOWN = 12
const COMMIT_TIMEOUT_MS = 30_000

// Commits everything in the session's repo with a message the small model writes from the diff, after
// the person reads it and the files it takes: commit, commit and push, or type their own. It runs git
// itself, on that press, so it costs the main model nothing. One at a time: a second press while one
// runs does nothing
let isCommitting = false
async function quickCommit($: EngineInterface) {
  if (isCommitting) return
  isCommitting = true
  try {
    await commitWithMessage($)
  } finally {
    isCommitting = false
  }
}

async function commitWithMessage($: EngineInterface) {
  const root = (await read($, snap))?.git?.root
  if (!root) {
    $.ui.toast('Not in a git repo')
    return
  }
  const git = (...args: string[]) => runGit($, root, args, COMMIT_TIMEOUT_MS)
  const status = await git('status', '--porcelain')
  // "XY path", or "XY old -> new" for a rename
  const rows = (status?.stdout ?? '').split('\n').filter(row => row.trim() !== '')
  if (rows.length === 0) {
    $.ui.toast('Nothing to commit')
    return
  }
  const paths = rows.map(row => row.slice(3).split(' -> ').pop() ?? row.slice(3))
  const sensitive = paths.filter(isSensitivePath)
  $.ui.toast('✎  Writing a commit message…')
  const [diff, log] = await Promise.all([git('diff', 'HEAD'), git('log', '-5', '--format=%s')])
  const untracked = rows.filter(row => row.startsWith('??')).map(row => row.slice(3))
  const written = await $.model.complete({
    model: 'haiku',
    maxTokens: 400,
    system:
      'You write git commit messages. Reply with the message alone: a subject line under 72 characters in the style of the recent subjects, a blank line, then a short body saying what changed and why. No code fences, no quotes, and no line crediting anyone.',
    prompt: [
      `Recent subjects:\n${log?.stdout.trim() ?? ''}`,
      untracked.length > 0 ? `New files:\n${untracked.join('\n')}` : '',
      `Diff:\n${(diff?.stdout ?? '').slice(0, 24_000)}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  })
  if (!written.isAnswered) {
    $.ui.toast(`Could not write a message (${written.reason})`)
    return
  }
  const proposed = cleanCommitMessage(written.text)
  const listed = rows.slice(0, FILES_SHOWN).map(row => `  ${row}`)
  const more = rows.length > FILES_SHOWN ? [`  …and ${rows.length - FILES_SHOWN} more`] : []
  const warning =
    sensitive.length > 0 ? [`⚠ May hold secrets: ${sensitive.join(', ')}. Cancel and add them to .gitignore if so.`, ''] : []
  const COMMIT = 'Commit'
  const PUSH = 'Commit and push'
  const CANCEL = 'Cancel'
  const count = `${rows.length} ${rows.length === 1 ? 'file' : 'files'}`
  const answer = await $.ui
    .ask([`Commit ${count} with this message? (or type your own)`, '', ...warning, ...listed, ...more, '', proposed].join('\n'), {
      options: [COMMIT, PUSH, CANCEL],
      header: 'Commit',
    })
    .catch(() => CANCEL)
  if (answer === CANCEL) return
  // A message the person typed goes in as they typed it; git takes it as one argument, so it needs no
  // quoting or cleaning
  const message = answer === COMMIT || answer === PUSH ? proposed : answer.trim()
  if (!message) return
  const added = await git('add', '-A')
  const committed = added?.exitCode === 0 ? await git('commit', '-q', '-m', message) : added
  if (committed?.exitCode !== 0) {
    const why = (committed?.stderr || committed?.stdout || '').trim().split('\n')[0] ?? ''
    $.ui.toast(`Commit failed${why ? `: ${why}` : ''}`)
    return
  }
  if (answer === PUSH) {
    const pushed = await git('push')
    const why = (pushed?.stderr ?? '').trim().split('\n')[0] ?? ''
    $.ui.toast(pushed?.exitCode === 0 ? '✓  Committed and pushed' : `Committed, but the push failed${why ? `: ${why}` : ''}`)
  } else {
    $.ui.toast('✓  Committed')
  }
  await refresh($)
}

async function compactNow($: EngineInterface) {
  if (await read($, isCompacting)) return
  await update($, isCompacting, () => true)
  $.ui.toast('🗜  Compacting the conversation…')
  try {
    await $.session.compact()
    await refresh($)
  } finally {
    await update($, isCompacting, () => false)
  }
}

// After a turn that changed files, offers "commit and push" in the empty prompt box, for Tab to take
async function suggestAfterTurn($: EngineInterface) {
  await refresh($)
  const changed = (await read($, snap))?.git?.changed ?? 0
  if (changed > 0 && changed !== runtime.changedAtStart) {
    await $.prompt.suggest({ text: 'commit and push' }).catch(() => undefined)
  }
}

// ── The hooks

const RUNNER_TICK_MS = 120
const RUNNER_MAX_TICKS = 15_000

// Clawd's running animation, from a prompt until its turn completes
let runner: { cancel: () => void } | null = null

export const register: Register = (on, options) => {
  runtime.config = readConfig(options)

  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    startTimers($)
    void refresh($)
    if (runtime.config.spotify) {
      await $.command.register({ name: SEARCH_PANE, description: 'Search Spotify and play a track' })
    }
    await $.command.register({
      name: HISTORY_PANE,
      description: `Show cost and tokens for each of the last ${runtime.config.rollingDays} days`,
    })
    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    startTimers($)
    await markActive($)
    runtime.changedAtStart = (await read($, snap))?.git?.changed ?? 0
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
      // The local date the last refresh read, or the clock's when there has been none yet
      const day = (await read($, snap))?.day || (await $.process.run(['date', '+%Y-%m-%d'])).stdout.trim()
      await recordTokens($, await $.session.id(), day, input + used.output_tokens)
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
    runtime.config.noAttribution && (e.kind === 'commit' || e.kind === 'pr') ? { text: '' } : next(e),
  )

  // The system prompt learns how git goes in this repo: what each switch asks, the plain form, and no
  // credit lines with attribution off
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const root = (await read($, snap))?.git?.root
    if (!root) return composed
    const text = gitGuide(root, await readGitAuto($, root), runtime.config.noAttribution)
    return { sections: [...composed.sections, { id: 'statusline-band:git', text, scope: 'session' as const }] }
  })

  // The permission mode and effort ride on each prompt and each finished tool call, so a mode changed
  // mid-turn is seen from the next call on
  on('classic.UserPromptSubmit', async ($, e, next) => {
    runtime.permissionMode = e.permission_mode
    runtime.effort = e.effort?.level ?? runtime.effort
    return next(e)
  })
  on('classic.PostToolUse', async ($, e, next) => {
    runtime.permissionMode = e.permission_mode ?? runtime.permissionMode
    runtime.effort = e.effort?.level ?? runtime.effort
    return next(e)
  })

  // The switches at work. A git add, commit or push (an alias for one included) asks while its switch is
  // on ask. On auto it runs without a prompt only in its plain form, naming its repo with -C (git -C
  // /path add|commit -m '...'|push, joined by &&). Any other shape asks whatever the switch says: its
  // repo or what it runs is uncertain. In plan mode nothing is allowed
  on('classic.PreToolUse', { tool: 'Bash' }, async ($, e, next) => {
    const first = looseGitSteps(e.command)
    if (first.steps.length === 0 && first.aliases.length === 0) return next(e)
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
    const aliased = await stepsOfAliases($, plain?.dir ?? cwd, loose.aliases)
    const steps = [...new Set([...(plain?.steps ?? loose.steps), ...aliased])]
    const root = plain?.dir !== undefined ? await repoRoot($, plain.dir) : null
    const auto = root !== null ? await readGitAuto($, root) : REVIEW
    const decision = gitDecision(plain, steps, auto, runtime.permissionMode)
    if (decision === 'pass') return below
    if (decision === 'allow') return { ...kept, allow: true }
    // With gitStrict off, the person trusts their own repo: a shape that is not plain (or does not name its
    // repo) asks only when a switch of the session's repo, or the repo it names, says ask
    if (!runtime.config.gitStrict) {
      const trusted = root ?? (await repoRoot($, cwd))
      const trustedAuto = trusted !== null ? await readGitAuto($, trusted) : REVIEW
      if (steps.every(step => trustedAuto[step])) return below
    }
    // Under the dialog: what this step takes with it, in the repo it names or the session's
    const shownRoot = root ?? (await repoRoot($, cwd))
    if (shownRoot !== null) {
      const summary = await pendingSummary($, shownRoot, steps)
      if (summary) $.ui.notice(e.tool_use_id, summary)
    }
    if (root === null || plain === null) {
      return {
        ...kept,
        ask: 'Confirm this git step. On auto the band only lets plain git add, commit -m and push through, each naming its repo with -C.',
      }
    }
    const name = root.split('/').filter(Boolean).pop() ?? root
    const held = steps.filter(step => !auto[step])
    const doing = held.map(step => (step === 'push' ? 'pushing' : 'committing')).join(' and ')
    const switches = held.map(step => `"${step}"`).join(' and ')
    return { ...kept, ask: `${name} asks before ${doing}. Switch ${switches} to auto in the band to skip this.` }
  })

  on('command.run', { command: HISTORY_PANE }, async $ => {
    const day = (await read($, snap))?.day || (await $.process.run(['date', '+%Y-%m-%d'])).stdout.trim()
    await openHistory($, day)
    return { text: 'Usage history opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: HISTORY_PANE }, async ($, e) => {
    const days = await read($, history)
    const span = runtime.config.rollingDays
    return drawHistoryPane($.ui.resolve(e), {
      days,
      span,
      rows: e.viewport?.rows ?? 40,
      onCopy: () =>
        void $.ui
          .copy({ text: historyText(days, span) })
          .then(copied => $.ui.toast(copied.isCopied ? '✓  Copied' : 'Could not copy')),
    })
  })

  on('command.run', { command: SEARCH_PANE }, async $ => {
    await openSearch($)
    return { text: 'Spotify search opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: SEARCH_PANE }, async ($, e) => {
    const state = await read($, search)
    return drawSearchPane($.ui.resolve(e), {
      ...state,
      playingUri: (await read($, music))?.trackId ?? null,
      onSearch: query => void searchSpotify($, query),
      onPlay: track => void playFound($, track),
    })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snap)
    if (e.props.hasSurvey || s === null) return next(e)
    const isWorking = e.props.isWorking
    return drawBand($.ui.resolve(e), {
      s,
      config: runtime.config,
      effort: runtime.effort,
      isWorking,
      bodyColumns: e.props.bodyColumns,
      isCompacting: await read($, isCompacting),
      turn: await read($, lastTurn),
      feeling: isWorking ? 'idle' : await read($, mood),
      beat: await read($, moodTick),
      danceTick: await read($, danceTick),
      tick: isWorking ? await read($, frame) : null,
      isBlinking: await read($, isBlinking),
      music: runtime.config.spotify ? await read($, music) : null,
      isMusicCompact: await read($, musicCompact),
      isCardCompact: await read($, cardCompact),
      onCardCompact: () => void toggleCardCompact($),
      canDrawArt: e.surface === 'terminal',
      logoFile: e.surface === 'terminal' ? `${$.plugin.root}/assets/spotify.png` : undefined,
      actions: ACTIONS,
      onHistory: () => void openHistory($, s.day),
      onCompact: () => void compactNow($),
      onAction: action =>
        void (action.prompt === undefined ? quickCommit($) : $.prompt.submit({ text: action.prompt, asUser: true })),
      onSwitch: step => void toggleGitAuto($, step),
      onMusic: command => void controlSpotify($, command),
    })
  })
}
