// The band's pure parts: formatting, dates, pace and settings, apart so they can be tested
import type { PluginOptions } from 'claude-code'

export const BAR_CELLS = 8
export const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 }
// Too early in a window, one burst would read as a runaway pace
export const PACE_MIN_ELAPSED = 0.05
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// What each person sets for themselves in /config, the manifest's userConfig, with out-of-range numbers clamped
export const DEFAULTS = { initials: '', card: '#0a0a0a', padRows: 1, rollingDays: 30, noAttribution: false, gitStrict: true, spotify: true, plan: '', spotifyClientId: '', spotifyClientSecret: '' }

export const readConfig = (options: PluginOptions) => {
  const text = (key: string, fallback: string) => (typeof options[key] === 'string' ? (options[key] as string) : fallback)
  const whole = (key: string, fallback: number, lo: number, hi: number) =>
    typeof options[key] === 'number' ? Math.min(hi, Math.max(lo, Math.round(options[key] as number))) : fallback
  return {
    initials: text('initials', DEFAULTS.initials),
    card: text('cardColor', DEFAULTS.card),
    padRows: whole('padRows', DEFAULTS.padRows, 0, 2),
    rollingDays: whole('historyDays', DEFAULTS.rollingDays, 7, 62),
    noAttribution: typeof options.noAttribution === 'boolean' ? options.noAttribution : DEFAULTS.noAttribution,
    gitStrict: typeof options.gitStrict === 'boolean' ? options.gitStrict : DEFAULTS.gitStrict,
    spotify: typeof options.spotify === 'boolean' ? options.spotify : DEFAULTS.spotify,
    plan: text('plan', DEFAULTS.plan).trim(),
    spotifyClientId: text('spotifyClientId', DEFAULTS.spotifyClientId).trim(),
    spotifyClientSecret: text('spotifyClientSecret', DEFAULTS.spotifyClientSecret).trim(),
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

// The git steps the per-repo switches govern: add and commit under "commit", push under "push"
export type GitStep = 'commit' | 'push'

// A command the switches may allow without a prompt: one or more plain git steps joined by &&, all
// in one repo, with nothing a shell could expand or redirect. Anything else is not plain, and asks.
export type PlainGit = { steps: GitStep[]; dir?: string }

// Splits a command into words, or gives null when it holds anything beyond plain words, single-quoted
// text and && (double quotes, $, backticks, ;, |, redirections, newlines outside quotes, ~, globs...)
const plainWords = (command: string): string[] | null => {
  const words: string[] = []
  let word = ''
  let isInWord = false
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i] ?? ''
    if (c === "'") {
      const end = command.indexOf("'", i + 1)
      if (end === -1) return null
      word += command.slice(i + 1, end)
      isInWord = true
      i = end
    } else if (c === ' ' || c === '\t') {
      if (isInWord) words.push(word)
      word = ''
      isInWord = false
    } else if (c === '&') {
      if (command[i + 1] !== '&' || isInWord) return null
      words.push('&&')
      i += 1
    } else if (/[\w./@%+=:,-]/.test(c)) {
      word += c
      isInWord = true
    } else {
      return null
    }
  }
  if (isInWord) words.push(word)
  return words
}

// A remote or a branch: no leading dash, no "+" (a force refspec) and no ":" (a src:dst refspec)
const NAME = /^[\w.@/%=,][\w.@/%=,-]*$/
// A file to add: anything that does not start with a dash; a quoted one may hold spaces
const FILE = /^[^-\n][^\n]*$/
// The repo's folder: an absolute path; quoted, it may hold spaces or letters beyond ASCII
const ABSOLUTE = /^\/[^\n]*$/

// Flags that only shape what a reading step prints; anything else (--output writes a file) is not plain
const READ_FLAG =
  /^(?:-q|--quiet|--oneline|--stat|--shortstat|--short|--porcelain|--name-only|--name-status|--graph|--decorate|--no-color|-n|-\d+|--format=[^\s]*|--pretty=[^\s]*)$/
const READ_VERBS = new Set(['status', 'log', 'diff', 'show'])

// One git step in its strict form, or null: add files, commit with -m messages, push a branch, or a
// step that only reads (status, log, diff, show), which the switches do not govern
const plainStep = (args: string[]): { step?: GitStep; dir?: string } | null => {
  let rest = args
  let dir: string | undefined
  if (rest[0] === '-C') {
    if (!ABSOLUTE.test(rest[1] ?? '')) return null
    dir = rest[1]
    rest = rest.slice(2)
  }
  const [verb, ...tail] = rest
  if (verb !== undefined && READ_VERBS.has(verb)) {
    return tail.every(arg => READ_FLAG.test(arg) || NAME.test(arg)) ? { dir } : null
  }
  if (verb === 'add') {
    const isPlain = tail.length > 0 && tail.every(arg => arg === '-A' || arg === '--all' || FILE.test(arg))
    return isPlain ? { step: 'commit', dir } : null
  }
  if (verb === 'commit') {
    let messages = 0
    for (let i = 0; i < tail.length; i += 1) {
      const arg = tail[i]
      if (arg === '-m') {
        if (tail[i + 1] === undefined) return null
        messages += 1
        i += 1
      } else if (arg !== '-q' && arg !== '--quiet' && arg !== '-a' && arg !== '--all') {
        return null
      }
    }
    return messages > 0 ? { step: 'commit', dir } : null
  }
  if (verb === 'push') {
    const flags = tail.filter(arg => arg.startsWith('-'))
    const names = tail.filter(arg => !arg.startsWith('-'))
    const isPlain =
      flags.every(arg => arg === '-u' || arg === '--set-upstream' || arg === '-q' || arg === '--quiet') &&
      names.length <= 2 &&
      names.every(arg => NAME.test(arg))
    return isPlain ? { step: 'push', dir } : null
  }
  return null
}

export const parsePlainGit = (command: string): PlainGit | null => {
  const words = plainWords(command.trim())
  if (words === null || words.length === 0) return null
  const steps = new Set<GitStep>()
  const dirs = new Set<string | undefined>()
  let segment: string[] = []
  for (const word of [...words, '&&']) {
    if (word !== '&&') {
      segment.push(word)
      continue
    }
    if (segment[0] !== 'git') return null
    const step = plainStep(segment.slice(1))
    if (step === null) return null
    if (step.step) steps.add(step.step)
    dirs.add(step.dir)
    segment = []
  }
  // Every step in one repo: all with the same -C, or all without one
  if (dirs.size !== 1) return null
  return { steps: [...steps], dir: [...dirs][0] }
}

// The git steps a command may take, read loosely so a step in any shape is still seen. git counts where
// a command starts (after &&, ;, |, a newline, a subshell, `sh -c "`, eval) or behind a wrapper (env,
// xargs, timeout, sudo, VAR=value...), as a path (/usr/bin/git), quoted ("git") or escaped (\git), with
// any of its own options before the verb. Reading too much only asks more.
const COMMAND_START = String.raw`(?:^|[;&|\n(\`{!]|\$\(|-c\s+["']|\beval\s+["']?)\s*`
const WRAPPER = String.raw`(?:[A-Za-z_][A-Za-z0-9_]*=\S*|env|command|builtin|exec|time|nice|nohup|xargs|sudo|doas|caffeinate|stdbuf|timeout|ionice|unbuffer|chronic)`
const GIT_WORD = String.raw`["'\\]?(?:\S*/)?git["']?`
const GIT_OPTION = String.raw`(?:-[Cc]\s+\S+|--(?:git-dir|work-tree|namespace|exec-path|super-prefix|config-env)(?:=|\s+)\S+|-\S+)`
const LOOSE_STEP = new RegExp(
  String.raw`${COMMAND_START}(?:${WRAPPER}(?:\s+(?!["'\\]?(?:\S*/)?git\b)\S+)*?\s+)*${GIT_WORD}(?:\s+${GIT_OPTION})*\s+["']?([A-Za-z][\w-]*)`,
  'g',
)

// git's own commands besides add, commit and push: the switches leave them to the usual permissions.
// Any other word after git may be an alias, which the hook looks up
const OTHER_VERBS = new Set([
  'status', 'log', 'diff', 'show', 'branch', 'fetch', 'rev-parse', 'rev-list', 'ls-files', 'ls-tree',
  'remote', 'config', 'blame', 'grep', 'describe', 'shortlog', 'reflog', 'cat-file', 'check-ignore',
  'for-each-ref', 'symbolic-ref', 'stash', 'tag', 'help', 'version', 'whatchanged', 'name-rev',
  'merge-base', 'show-ref', 'var', 'count-objects', 'fsck', 'notes', 'worktree', 'switch', 'checkout',
  'restore', 'clean', 'reset', 'rm', 'mv', 'pull', 'merge', 'rebase', 'cherry-pick', 'revert', 'init',
  'clone', 'archive', 'bisect', 'submodule', 'sparse-checkout', 'maintenance', 'gc', 'prune', 'am',
  'apply', 'format-patch', 'difftool', 'mergetool', 'range-diff', 'cherry', 'request-pull',
])

export type LooseGit = { steps: GitStep[]; aliases: string[] }

// A heredoc's body is data unless a shell reads it: "python3 - <<'EOF'" or "cat <<EOF" feed text to a
// program, "bash <<EOF" runs it. Bodies fed to anything but a shell are left out before reading for git
const HEREDOC_FED = /(^|\n)([^\n]*?)<<-?\s*(['"]?)(\w+)\3[^\n]*\n[\s\S]*?\n\s*\4\s*(?=\n|$)/g
const SHELL_READS = /(?:^|[\s;&|(])(?:sh|bash|zsh|dash|ksh|fish|eval|source|\.)\s*(?:-\S+\s*)*$/

export const withoutDataHeredocs = (command: string) =>
  command.replace(HEREDOC_FED, (whole, start: string, before: string) =>
    SHELL_READS.test(before.trim().replace(/\s*<*$/, '')) ? whole : `${start}${before}<<HEREDOC`,
  )

export const looseGitSteps = (command: string): LooseGit => {
  const steps = new Set<GitStep>()
  const aliases = new Set<string>()
  for (const [, verb = ''] of withoutDataHeredocs(command).matchAll(LOOSE_STEP)) {
    if (verb === 'push') steps.add('push')
    else if (verb === 'add' || verb === 'commit') steps.add('commit')
    else if (!OTHER_VERBS.has(verb)) aliases.add(verb)
  }
  return { steps: [...steps], aliases: [...aliases] }
}

// The steps a git alias takes, from its expansion: a shell alias ("!...") may do anything, so both
export const aliasSteps = (expansion: string): GitStep[] => {
  const text = expansion.trim()
  if (text.startsWith('!')) return ['commit', 'push']
  const [verb] = text.split(/\s+/)
  if (verb === 'push') return ['push']
  if (verb === 'add' || verb === 'commit') return ['commit']
  return []
}

// What the switches make of a command. Allow only a plain one that names its repo (-C /path) with every
// step on auto, and never in plan mode; ask for any other that takes a git step, since its repo or its
// shape is uncertain; pass the rest to the usual permissions
export const gitDecision = (
  plain: PlainGit | null,
  steps: GitStep[],
  auto: Record<GitStep, boolean>,
  mode?: string,
): 'pass' | 'ask' | 'allow' => {
  if (steps.length === 0) return 'pass'
  if (mode === 'plan') return 'pass'
  const isCertain = plain !== null && plain.dir !== undefined
  return isCertain && steps.every(step => auto[step]) ? 'allow' : 'ask'
}

// Lines that credit Claude in a commit or pull request: Co-Authored-By naming Claude, a Claude-Session
// link, the "Generated with Claude Code" footer
const CLAUDE_CREDIT = /^\s*(?:co-authored-by:.*\bclaude\b.*|claude-session:.*|.*generated with \[?claude code\]?.*)$/gim

// A commit message as a model wrote it, made ready to commit: no code fences or wrapping quotes, no line
// crediting Claude, blank runs collapsed
export const cleanCommitMessage = (text: string) =>
  text
    .replace(/^\s*```\w*\n?|\n?```\s*$/g, '')
    .replace(/^\s*(["'])([\s\S]*)\1\s*$/, '$2')
    .replace(CLAUDE_CREDIT, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

// "--shortstat" output as lines added and removed
export const parseShortstat = (text: string) => ({
  added: Number(/(\d+) insertion/.exec(text)?.[1] ?? 0),
  removed: Number(/(\d+) deletion/.exec(text)?.[1] ?? 0),
})

// "git status --porcelain=v2 --branch --show-stash" in one read: the branch (a short commit when
// detached), its upstream, how far ahead and behind, stashes, and how many paths changed
export const parseStatusV2 = (text: string) => {
  let oid = ''
  let head = ''
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  let stashed = 0
  let changed = 0
  for (const row of text.split('\n')) {
    if (row.startsWith('# branch.oid ')) oid = row.slice(13).trim()
    else if (row.startsWith('# branch.head ')) head = row.slice(14).trim()
    else if (row.startsWith('# branch.upstream ')) upstream = row.slice(18).trim()
    else if (row.startsWith('# branch.ab ')) {
      const [a = '0', b = '0'] = row.slice(12).trim().split(/\s+/)
      ahead = Math.abs(Number(a))
      behind = Math.abs(Number(b))
    } else if (row.startsWith('# stash ')) stashed = Number(row.slice(8).trim())
    else if (row.trim() !== '' && !row.startsWith('#') && !row.startsWith('! ')) changed += 1
  }
  const branch = head && head !== '(detached)' ? head : oid && oid !== '(initial)' ? oid.slice(0, 7) : ''
  return { branch, upstream, ahead, behind, stashed, changed }
}

// Paths that may hold secrets, to warn about before they are committed
const SENSITIVE = /(?:^|\/)(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx|keystore|jks)|id_(?:rsa|dsa|ecdsa|ed25519)|credentials(?:\.json)?|secrets?\.[a-z]+|\.npmrc|\.netrc)$/i
export const isSensitivePath = (path: string) => SENSITIVE.test(path.trim())

// Single-quoted for the shell, or null when the text holds a single quote and cannot be
export const shellQuote = (text: string) => (text.includes("'") ? null : `'${text}'`)

// What the system prompt tells Claude about git in the session's repo: what each switch asks of it (on
// auto it commits or pushes on its own; on ask only when asked), the plain form the switches let
// through, and no credit lines when the person turned attribution off
export const gitGuide = (root: string, auto: Record<GitStep, boolean>, noAttribution: boolean) => {
  const name = root.split('/').filter(Boolean).pop() ?? root
  const state = (step: GitStep) => (auto[step] ? 'auto' : 'ask')
  const commit = auto.commit
    ? 'Commit on your own: whenever you finish a complete change, commit it with a clear message, without being asked.'
    : 'Commit only when the user asks; they confirm each commit.'
  const push = auto.push
    ? auto.commit
      ? 'Push on your own, right after each commit.'
      : 'When the user has you commit, push right after.'
    : 'Push only when the user asks; they confirm each push.'
  const repo = shellQuote(root)
  const form =
    repo === null
      ? 'This repo path holds a single quote, so the plain form cannot name it: every git add, commit and push here asks.'
      : `When you add, commit or push here, use only the plain form, so the switches can let it through: \`git -C ${repo} add <files>\`, \`git -C ${repo} commit -m '<message>'\` and \`git -C ${repo} push\`, joined with && when you do more than one, every step with that same -C. Put the whole message in single quotes (it may span lines) and leave apostrophes out of it. Do not use heredocs, $(...), cd, pipes, or git options before the step: any of those always asks.`
  return [
    `# Git in ${name}`,
    `The user's git switches for this repo: commit is ${state('commit')}, push is ${state('push')}. ${commit} ${push}`,
    form,
    ...(noAttribution
      ? ['Do not credit Claude in commits or pull requests: no Co-Authored-By line naming Claude, no Claude-Session line, no "Generated with Claude Code" footer.']
      : []),
  ].join('\n')
}

// ── Spotify

// What Spotify is playing, as the AppleScript in register.tsx reports it: fields joined by the unit
// separator (\x1f), so a track name with a newline or a comma stays whole
export type NowPlaying = {
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
  // 0 to 100
  volume: number
}

export const parseSpotify = (text: string): NowPlaying | null => {
  const [state, name = '', artist = '', album = '', duration = '0', position = '0', artUrl = '', trackId = '', shuffling = '', repeating = '', volume = '0'] = text
    .replace(/\n$/, '')
    .split('\x1f')
  if (state !== 'playing' && state !== 'paused') return null
  if (!name) return null
  return {
    isPlaying: state === 'playing',
    name,
    artist,
    album,
    durationMs: Number(duration) || 0,
    // A locale may write the seconds with a decimal comma
    positionMs: Math.round((Number(position.replace(',', '.')) || 0) * 1000),
    artUrl,
    trackId,
    isShuffling: shuffling === 'true',
    isRepeating: repeating === 'true',
    volume: Math.min(100, Math.max(0, Number(volume) || 0)),
  }
}

// A track heard, for the band's "recently played": what it was and when it stopped playing
export type PlayedTrack = { trackId: string; name: string; artist: string; at: number }

// The list after a track has played: newest first, no track twice in a row, at most `keep`
export const addPlayed = (list: PlayedTrack[], track: PlayedTrack, keep = 20) =>
  [track, ...list.filter(t => t.trackId !== track.trackId)].slice(0, keep)

// Milliseconds as "3:07", or "1:02:07" past an hour
export const formatClock = (ms: number) => {
  const secs = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = String(secs % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Base64, written out so it needs nothing from the environment
export const toBase64 = (bytes: Uint8Array) => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += B64[(n >> 18) & 63]
    out += B64[(n >> 12) & 63]
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '='
    out += i + 2 < bytes.length ? B64[n & 63] : '='
  }
  return out
}

export const fromBase64 = (text: string) => {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let n = 0
  let bits = 0
  let at = 0
  for (const ch of clean) {
    n = (n << 6) | B64.indexOf(ch)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[at++] = (n >> bits) & 0xff
    }
  }
  return bytes.slice(0, at)
}

// The pixels of an uncompressed 24- or 32-bit BMP (what `sips -s format bmp` writes), top row first, as
// 0xRRGGBB; null for anything else
export const readBmp = (bytes: Uint8Array): { width: number; height: number; pixels: number[] } | null => {
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const offset = view.getUint32(10, true)
  const width = view.getInt32(18, true)
  const rawHeight = view.getInt32(22, true)
  const bpp = view.getUint16(28, true)
  const compression = view.getUint32(30, true)
  // 0: plain RGB; 3: bit fields, which sips uses for 32-bit with the usual BGRA order
  if ((bpp !== 24 && bpp !== 32) || (compression !== 0 && compression !== 3) || width <= 0 || rawHeight === 0) return null
  const height = Math.abs(rawHeight)
  const isBottomUp = rawHeight > 0
  const step = bpp / 8
  const stride = Math.ceil((width * step) / 4) * 4
  if (offset + stride * height > bytes.length) return null
  const pixels: number[] = []
  for (let y = 0; y < height; y += 1) {
    const row = isBottomUp ? height - 1 - y : y
    for (let x = 0; x < width; x += 1) {
      const at = offset + row * stride + x * step
      pixels.push(((bytes[at + 2] ?? 0) << 16) | ((bytes[at + 1] ?? 0) << 8) | (bytes[at] ?? 0))
    }
  }
  return { width, height, pixels }
}

// A pixel left clear: the terminal's own background shows through it
export const CLEAR = 0x01000000

// A picture as Raster cells, two pixels a cell: an upper half block (▀) with the upper pixel as ink and
// the lower as paper. A clear pixel takes the terminal's own background: a clear pair is a space, and
// one clear half is drawn by the other half's block (▀ or ▄) over the terminal's paper; ink is never
// left to the terminal, whose own ink is its text color. Little-endian u32 triplets, base64
export const pixelsToCells = (picture: { width: number; height: number; pixels: number[] }, columns: number, rows: number) => {
  const words = new Uint32Array(columns * rows * 3)
  const at = (x: number, y: number) => {
    const px = Math.min(picture.width - 1, Math.floor((x * picture.width) / columns))
    const py = Math.min(picture.height - 1, Math.floor((y * picture.height) / (rows * 2)))
    return picture.pixels[py * picture.width + px] ?? 0
  }
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const i = (r * columns + c) * 3
      const upper = at(c, r * 2)
      const lower = at(c, r * 2 + 1)
      const cell =
        upper === CLEAR && lower === CLEAR
          ? [0x20, CLEAR, CLEAR]
          : upper === CLEAR
            ? [0x2584, lower, CLEAR]
            : lower === CLEAR
              ? [0x2580, upper, CLEAR]
              : [0x2580, upper, lower]
      words.set(cell, i)
    }
  }
  return toBase64(new Uint8Array(words.buffer))
}

// Raster cells with some replaced by a character in a color on a clear background, such as the Z's
// beside a sleeping mascot. Cells outside the grid are left out
export const withGlyphs = (
  cells: string,
  columns: number,
  glyphs: { column: number; row: number; char: string; color: number }[],
) => {
  const words = new Uint32Array(fromBase64(cells).slice().buffer)
  const rows = words.length / 3 / columns
  for (const g of glyphs) {
    if (g.column < 0 || g.column >= columns || g.row < 0 || g.row >= rows) continue
    words.set([g.char.codePointAt(0) ?? 0x20, g.color, CLEAR], (g.row * columns + g.column) * 3)
  }
  return toBase64(new Uint8Array(words.buffer))
}

// The Claude plan, from Claude Code's own ~/.claude.json: "Max 5x", "Max 20x", "Pro", "Team",
// "Enterprise", or null when the file says no plan (an API key, a missing account)
export const planLabel = (configText: string): string | null => {
  let account: { organizationType?: unknown; organizationRateLimitTier?: unknown } | undefined
  try {
    account = (JSON.parse(configText) as { oauthAccount?: typeof account }).oauthAccount
  } catch {
    return null
  }
  const type = typeof account?.organizationType === 'string' ? account.organizationType : ''
  const tier = typeof account?.organizationRateLimitTier === 'string' ? account.organizationRateLimitTier : ''
  if (type === 'claude_max') {
    const times = /(\d+)x/.exec(tier)?.[1]
    return times ? `Max ${times}x` : 'Max'
  }
  const names: Record<string, string> = { claude_pro: 'Pro', claude_team: 'Team', claude_enterprise: 'Enterprise' }
  return names[type] ?? null
}

// ── Spotify search, through the Web API with an app's own credentials (no user sign-in)

// UTF-8 bytes of a string, without TextEncoder
const utf8 = (text: string) => {
  const bytes: number[] = []
  for (const ch of unescape(encodeURIComponent(text))) bytes.push(ch.charCodeAt(0))
  return new Uint8Array(bytes)
}

// The Authorization header that trades an app's client id and secret for a token
export const basicAuth = (id: string, secret: string) => `Basic ${toBase64(utf8(`${id}:${secret}`))}`

// A track the search found
export type FoundTrack = { uri: string; name: string; artist: string; album: string; durationMs: number }

// The tracks in a search response, or null when the response is not one
export const parseSearch = (text: string): FoundTrack[] | null => {
  let body: { tracks?: { items?: unknown[] } }
  try {
    body = JSON.parse(text) as typeof body
  } catch {
    return null
  }
  const items = body.tracks?.items
  if (!Array.isArray(items)) return null
  const tracks: FoundTrack[] = []
  for (const item of items) {
    const t = item as {
      uri?: unknown
      name?: unknown
      duration_ms?: unknown
      artists?: { name?: unknown }[]
      album?: { name?: unknown }
    } | null
    if (!t || typeof t.uri !== 'string' || typeof t.name !== 'string') continue
    tracks.push({
      uri: t.uri,
      name: t.name,
      artist: (t.artists ?? []).map(a => (typeof a?.name === 'string' ? a.name : '')).filter(Boolean).join(', '),
      album: typeof t.album?.name === 'string' ? t.album.name : '',
      durationMs: typeof t.duration_ms === 'number' ? t.duration_ms : 0,
    })
  }
  return tracks
}

// A Spotify track URI that is safe to put inside an AppleScript string, or null
export const safeTrackUri = (uri: string) => (/^spotify:track:[A-Za-z0-9]+$/.test(uri) ? uri : null)

// Text cut or padded to exactly `n` columns, with … where it was cut
export const fitText = (text: string, n: number) => {
  const chars = [...text]
  if (n <= 0) return ''
  if (chars.length <= n) return text + ' '.repeat(n - chars.length)
  return `${chars.slice(0, n - 1).join('')}…`
}

// ── Lyrics: synced lines from LRCLIB (lrclib.net), found by the track's name, artist, album and length

export type LyricLine = { atMs: number; text: string }

// LRCLIB's lookup for one track; the length in whole seconds, which it matches within a couple
export const lyricsUrl = (m: { name: string; artist: string; album: string; durationMs: number }) =>
  `https://lrclib.net/api/get?${[
    ['track_name', m.name],
    ['artist_name', m.artist],
    ['album_name', m.album],
    ['duration', String(Math.round(m.durationMs / 1000))],
  ]
    .map(([k, v]) => `${k}=${encodeURIComponent(v ?? '')}`)
    .join('&')}`

// Synced LRC as lines in time order: "[01:02.34] words", a line with several stamps kept at each,
// empty lines kept (they clear the line shown), and tags such as [ar:...] skipped
export const parseLrc = (text: string): LyricLine[] => {
  const lines: LyricLine[] = []
  for (const raw of text.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)]
    if (stamps.length === 0) continue
    const words = raw.replace(/\[[^\]]*\]/g, '').trim()
    for (const [, min = '0', sec = '0'] of stamps) {
      lines.push({ atMs: Math.round((Number(min) * 60 + Number(sec.replace(':', '.'))) * 1000), text: words })
    }
  }
  return lines.sort((a, b) => a.atMs - b.atMs)
}

// The lines in LRCLIB's answer, an empty list when it has none synced (plain lyrics cannot follow the song)
export const parseLyrics = (json: string): LyricLine[] => {
  try {
    const got = JSON.parse(json) as { syncedLyrics?: unknown; instrumental?: unknown }
    return typeof got.syncedLyrics === 'string' ? parseLrc(got.syncedLyrics) : []
  } catch {
    return []
  }
}

// The line being sung at a moment and the one after it; before the first line, only what comes next
export const lyricAt = (lines: LyricLine[], positionMs: number): { current: string; next: string } => {
  let i = -1
  while (i + 1 < lines.length && (lines[i + 1]?.atMs ?? Infinity) <= positionMs) i++
  const after = lines.slice(i + 1).find(l => l.text !== '')
  return { current: lines[i]?.text ?? '', next: after?.text ?? '' }
}

// Where a playing track is now, counting on from when Spotify was last read; never past its end
export const livePosition = (m: { isPlaying: boolean; positionMs: number; durationMs: number; readAt?: number }, now: number) =>
  m.isPlaying && m.readAt !== undefined ? Math.min(m.durationMs || Infinity, m.positionMs + Math.max(0, now - m.readAt)) : m.positionMs
