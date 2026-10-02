export type Limit = { kind: string; percent: number; resetsAt?: string; resetsOn?: string }

export type Snapshot = {
  folder: string
  // The path below the repo's root, as "/mod/x", when the session runs in a subfolder
  subdir: string
  git: {
    root: string | null
    branch: string
    changed: number
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
  startedAt: number
  now: number
  time: string
  context: { percent: number; tokens: number; window: number } | null
  costUsd: number | null
  todayUsd: number | null
  monthUsd: number | null
  limits: Limit[]
}

// Kept in $.store across sessions: spend per day, and each session's last reading
export type CostLedger = {
  days: Record<string, number>
  sessions: Record<string, number>
}

declare module 'claude-code' {
  interface PluginState {
    'statusline-band': { snap: Snapshot | null; isCompacting: boolean; frame: number; isBlinking: boolean }
  }
}
