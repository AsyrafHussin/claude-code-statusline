export type Limit = {
  kind: string
  percent: number
  resetsAt?: string
  resetsOn?: string
  // Percent per millisecond over the last few hours, once there is enough to tell
  recentRate?: number
}

// Kept in $.store across sessions: readings of each window, by "kind@resetsAt"
export type PaceLog = Record<string, { t: number; pct: number }[]>

// Kept in $.store across sessions: tokens per day, and per session, counted at each turn's end
export type TokenLedger = {
  days: Record<string, number>
  sessions: Record<string, number>
}

// The last turn's tokens: read in, cache included, and written out
export type TurnTokens = { input: number; output: number; cached?: number }

// Clawd's mood while Claude is not working
export type Mood = 'idle' | 'cheer' | 'sleep' | 'sweat'

// What Spotify plays, with the last few tracks heard
export type Music = {
  isPlaying: boolean
  name: string
  artist: string
  album: string
  durationMs: number
  positionMs: number
  artUrl: string
  trackId: string
  isShuffling: boolean
  isRepeating: boolean
  volume: number
  // When the track was paused, epoch ms; null while it plays
  pausedAt: number | null
  // The last few tracks heard before this one, newest first
  recent: { trackId: string; name: string; artist: string; at: number }[]
}

// The Spotify search dialog: what was asked, how it went, and the tracks found
export type SpotifySearch = {
  query: string
  status: 'idle' | 'searching' | 'found' | 'failed'
  message: string
  tracks: { uri: string; name: string; artist: string; album: string; durationMs: number }[]
}

// One day in the history pane
export type HistoryDay = { day: string; usd: number; tokens: number }

export type Snapshot = {
  folder: string
  // The path below the repo's root, as "/mod/x", when the session runs in a subfolder
  subdir: string
  git: {
    root: string | null
    branch: string
    changed: number
    // The upstream branch, as "origin/main"; null when the branch has none
    upstream: string | null
    hasUpstream: boolean
    ahead: number
    behind: number
    // Lines in uncommitted work, and in commits not yet pushed
    added: number
    removed: number
    unpushedAdded: number
    unpushedRemoved: number
    stashed: number
    // Epoch ms of the last commit, null in a repo with none
    lastCommitAt: number | null
  } | null
  model: string
  // The effort level, as the last prompt or tool call carried it
  effort?: string
  // The Claude plan, as "Max 5x" or "Pro"
  plan?: string
  startedAt: number
  now: number
  // The local date, "2026-10-02", and time, "11:42 AM"
  day: string
  time: string
  context: { percent: number; tokens: number; window: number } | null
  costUsd: number | null
  todayUsd: number | null
  // Tokens read and written, cache included, as counted since the mod was installed
  tokens: { session: number; today: number; rolling: number }
  // Spend over the last 30 days, today included
  rollingUsd: number | null
  limits: Limit[]
  // Subagents running right now
  agents: number
  // The repo's switches: whether Claude may commit, and push, without asking; null outside a repo
  gitAuto: { commit: boolean; push: boolean } | null
}

// Kept in $.store across sessions: spend per day, and each session's last reading
export type CostLedger = {
  days: Record<string, number>
  sessions: Record<string, number>
}

declare module 'claude-code' {
  interface PluginState {
    'statusline-band': { snap: Snapshot | null; isCompacting: boolean; frame: number; isBlinking: boolean; lastTurn: TurnTokens | null; history: HistoryDay[]; mood: Mood; moodTick: number; music: Music | null; danceTick: number; search: SpotifySearch; musicCompact: boolean; cardCompact: boolean }
  }
}
