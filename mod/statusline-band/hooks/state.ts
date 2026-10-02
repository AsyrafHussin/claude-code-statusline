// What the band's files share: its colors and keys, and the module-wide runtime. The state values (atoms)
// live in register.tsx, where the engine's scan can read them
import { DEFAULTS } from './logic'
import type { readConfig, GitStep } from './logic'

export const COLORS = {
  ok: '#4ade80',
  warn: '#fbbf24',
  hot: '#f87171',
  folder: '#fbbf24',
  branch: '#5eead4',
  model: '#7dd3fc',
  border: '#71717a',
  borderBusy: '#d97757',
}

export const LIMIT_LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }
export const GIT_TIMEOUT = { timeoutMs: 5000 }

export type Config = ReturnType<typeof readConfig>
export type GitAuto = Record<GitStep, boolean>
export const REVIEW: GitAuto = { commit: false, push: false }

// The module's own values: they start over on a reload, as the module does. The config is read in
// register; the permission mode and effort ride on the classic hooks' input
export const runtime = {
  config: DEFAULTS as Config,
  permissionMode: undefined as string | undefined,
  effort: undefined as string | undefined,
  // When the person last did something, and until when Clawd cheers
  lastActiveAt: null as number | null,
  cheerUntil: 0,
  // When Clawd's current mood began, so its animation can rest after a while
  moodSince: 0,
  // Uncommitted files when the turn began, so its end can tell whether the turn changed any
  changedAtStart: 0,
}
