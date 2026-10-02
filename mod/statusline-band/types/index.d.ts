export type Limit = { kind: string; percent: number; resetsAt?: string; resetsOn?: string }

export type Snapshot = {
  folder: string
  git: { branch: string; isDirty: boolean; hasUpstream: boolean; ahead: number; behind: number; added: number; removed: number } | null
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
    'statusline-band': { snap: Snapshot | null; ctxHistory: number[]; isCompacting: boolean; frame: number; isBlinking: boolean }
  }
}
