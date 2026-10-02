// The band's pure parts: formatting, dates, pace and settings, apart so they can be tested
import type { PluginOptions } from 'claude-code'

export const BAR_CELLS = 8
export const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 }
// Too early in a window, one burst would read as a runaway pace
export const PACE_MIN_ELAPSED = 0.05
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// What each person sets for themselves in /config, the manifest's userConfig, with out-of-range numbers clamped
export const DEFAULTS = { initials: '', card: '#0a0a0a', padRows: 1, rollingDays: 30 }

export const readConfig = (options: PluginOptions) => {
  const text = (key: string, fallback: string) => (typeof options[key] === 'string' ? (options[key] as string) : fallback)
  const whole = (key: string, fallback: number, lo: number, hi: number) =>
    typeof options[key] === 'number' ? Math.min(hi, Math.max(lo, Math.round(options[key] as number))) : fallback
  return {
    initials: text('initials', DEFAULTS.initials),
    card: text('cardColor', DEFAULTS.card),
    padRows: whole('padRows', DEFAULTS.padRows, 0, 2),
    rollingDays: whole('historyDays', DEFAULTS.rollingDays, 7, 62),
  }
}

// Up to two initials across the shirt, as " A H "; none leaves it plain
export const shirtText = (initials: string) => {
  const [a = ' ', b = ' '] = [...initials.replace(/\s/g, '').toUpperCase()]
  return ` ${a} ${b} `
}

// claude-opus-5-5 → Opus 5.5; anything else is shown as it came
export const prettyModel = (id: string) => {
  const [, family, major, minor] = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(id) ?? []
  return family ? `${family[0]?.toUpperCase()}${family.slice(1)} ${major}.${minor}` : id
}

export const formatTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}m` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`

export const formatUsd = (usd: number) => (usd >= 100 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`)

export const formatDuration = (ms: number) => {
  const secs = Math.max(0, Math.floor(ms / 1000))
  if (secs >= 3600) return `${Math.floor(secs / 3600)}h${Math.floor((secs % 3600) / 60)}m`
  if (secs >= 60) return `${Math.floor(secs / 60)}m`
  return `${secs}s`
}

export const formatReset = (ms: number) => {
  const mins = Math.floor(ms / 60_000)
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  if (days > 0) return `${days}d${hours}h`
  if (hours > 0) return `${hours}h${mins % 60}m`
  return `${mins}m`
}

// How long until a window runs out, when that comes before its reset: at the faster of the
// pace across the whole window and the recent pace (percent per millisecond)
export const runsOutIn = (kind: string, pct: number, resetMs: number, recentRate?: number) => {
  const windowMs = WINDOW_MS[kind]
  if (windowMs === undefined || pct <= 0 || pct >= 100) return undefined
  const elapsed = windowMs - resetMs
  if (elapsed < windowMs * PACE_MIN_ELAPSED) return undefined
  const rate = Math.max(pct / elapsed, recentRate ?? 0)
  const left = (100 - pct) / rate
  return left < resetMs ? left : undefined
}

// A local date ("2026-10-02") moved by whole days; a UTC calendar keeps the steps exact
export const shiftDay = (day: string, by: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10)

// "2026-10-02" as "Fri 02 Oct"
export const dayLabel = (day: string) => {
  const date = new Date(`${day}T00:00:00Z`)
  return `${WEEKDAYS[date.getUTCDay()]} ${day.slice(8)} ${MONTHS[date.getUTCMonth()]}`
}

// A pace in percent per millisecond, as "1.20%/h"
export const perHour = (rate: number) => `${(rate * 3_600_000).toFixed(2)}%/h`

// Filled cells for a percentage; any use at all shows at least one
export const barCells = (pct: number) => (pct <= 0 ? 0 : Math.min(BAR_CELLS, Math.max(1, Math.round((pct / 100) * BAR_CELLS))))

// The repo's name, with the path below its root when the session runs in a subfolder
export const placeFolder = (cwd: string, root: string | null) => {
  const base = (path: string) => path.split('/').filter(Boolean).pop() ?? path
  if (root === null || !cwd.startsWith(root)) return { folder: base(cwd), subdir: '' }
  return { folder: base(root), subdir: cwd.slice(root.length) }
}

// The sum of a ledger's days from `since` to `until`, both included
export const sumDays = (days: Record<string, number>, since: string, until: string) =>
  Object.entries(days).reduce((sum, [day, n]) => (day >= since && day <= until ? sum + n : sum), 0)
