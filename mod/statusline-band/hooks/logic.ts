// The band's pure parts: formatting, dates, pace and settings, apart so they can be tested
import type { PluginOptions } from 'claude-code'

export const BAR_CELLS = 8
export const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 }
// Too early in a window, one burst would read as a runaway pace
export const PACE_MIN_ELAPSED = 0.05
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// What each person sets for themselves in /config, the manifest's userConfig, with out-of-range numbers clamped
export const DEFAULTS = { initials: '', card: '#0a0a0a', padRows: 1, rollingDays: 30, noAttribution: false, gitStrict: true }

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
