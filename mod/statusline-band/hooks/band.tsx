// The band above the prompt: Clawd beside a card with the project, the rate limits, context, cost and
// git, and a row of actions under it
import type { Elements } from 'claude-code'

import {
  BAR_CELLS,
  WINDOW_MS,
  barCells,
  formatClock,
  formatDuration,
  formatReset,
  formatTokens,
  formatUsd,
  CLEAR,
  perHour,
  pixelsToCells,
  runsOutIn,
  shirtText,
} from './logic'
import type { GitStep } from './logic'
import { LOGO, LOGO_COLUMNS, LOGO_ROWS, PALETTE } from './spotify-logo'
import { COLORS, LIMIT_LABELS } from './state'
import type { Config, GitAuto } from './state'
import type { Limit, Mood, Music, Snapshot, TurnTokens } from '../types'

// The elements the band draws with, as $.ui.resolve gives them; Raster only on the terminal
export type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'> & Partial<Pick<Elements['terminal'], 'Raster' | 'Image'>>

// The album art's box, in cells: each cell shows two pixels, so the picture is 6 by 6, three rows tall
export const ART_COLUMNS = 6
export const ART_ROWS = 3
const SPOTIFY_GREEN = '#1db954'
// The pixel logo as Raster cells, once per load; null while spotify-logo.ts holds no grid
const LOGO_CELLS =
  LOGO.length > 0
    ? pixelsToCells(
        { width: LOGO_COLUMNS, height: LOGO_ROWS * 2, pixels: LOGO.join('').split('').map(c => PALETTE[c] ?? CLEAR) },
        LOGO_COLUMNS,
        LOGO_ROWS,
      )
    : null

export type MusicCommand = 'playpause' | 'next' | 'previous' | 'shuffle' | 'repeat' | 'louder' | 'quieter' | 'open'

// A button under the card: most send a prompt as if typed; one with no prompt runs itself (quick commit)
export type Action = { key: string; label: string; hotkey: string; prompt?: string }

// What the band needs to draw: the snapshot and the moment's state, and what each press does
export type BandView = {
  s: Snapshot
  config: Config
  effort?: string
  isWorking: boolean
  bodyColumns: number
  isCompacting: boolean
  turn: TurnTokens | null
  feeling: Mood
  beat: number
  // The running animation's frame while Claude works, else null
  tick: number | null
  isBlinking: boolean
  // What Spotify plays, null when it plays nothing (or the setting is off)
  music: Music | null
  canDrawArt: boolean
  // The Spotify logo, a PNG the plugin ships; absent where pictures cannot be drawn
  logoFile?: string
  actions: Action[]
  onHistory: () => void
  onCompact: () => void
  onAction: (action: Action) => void
  onSwitch: (step: GitStep) => void
  onMusic: (command: MusicCommand) => void
}

const RINGS = ['○', '◔', '◑', '◕', '●']
const COMPACT_AT = 80
// Room left for the band's own collapse mark ([-], three columns) on the right, with one to spare
const ENGINE_MARK_WIDTH = 4
// Columns of card left and right of the frame: a backgrounded Box paints over its own edge columns
// below its first row, so the frame sits one in
const CARD_INSET = 1

// Clawd, the Claude Code mascot, in a shirt with the person's initials: standing when idle, running while
// Claude works (arms and legs trade places each step, dust kicked up behind), and by mood otherwise
const CLAWD_COLOR = '#d97757'
const DUST_COLOR = '#78716c'
const SHIRT_COLOR = '#2563eb'
const SWEAT_COLOR = '#60a5fa'
const SPARK_COLOR = '#fde047'
const SLEEP_COLOR = '#a1a1aa'
const CLAWD_WIDTH = 11
// The column where Clawd's head and shirt begin, past the two columns kept for dust and his arm
const CLAWD_BODY_FROM = 3
// Where the actions under the card start, and the Spotify text with them: past Clawd and the frame's edge
const INDENT = CLAWD_WIDTH + CARD_INSET + 3
const CLAWD_HEAD = ' ▐▛███▜▌ '
const CLAWD_HEAD_BLINK = ' ▐█████▌ '
const CLAWD_IDLE = { arms: ['▝', '▘'], legs: '  ▘▘ ▝▝  ' }
const CLAWD_RUN = [
  { arms: ['▝', '▘'], legs: ' ▘ ▘ ▝ ▝ ' },
  { arms: ['▗', '▖'], legs: '  ▝▘ ▘▝  ' },
]
const CLAWD_CHEER = [
  { arms: ['▘', '▝'], legs: '  ▘▘ ▝▝  ' },
  { arms: ['▘', '▝'], legs: ' ▘ ▘ ▝ ▝ ' },
]
const DUST = [['  ', '  ', ' ·'], ['  ', ' ·', '∙ '], ['  ', '  ', '· ']]

const toneHex = (pct: number) => (pct >= 80 ? COLORS.hot : pct >= 50 ? COLORS.warn : COLORS.ok)
const ring = (pct: number) => RINGS[Math.min(4, Math.round((pct / 100) * 4))]

// The two columns left of Clawd: dust while running, else a falling drop (an emoji, two wide), z's or
// sparkles by mood
const clawdSide = (feeling: Mood, beat: number, dust: string[] | undefined): [string, string][] => {
  if (feeling === 'sweat') return [0, 1, 2].map(row => [row === beat % 3 ? '💧' : '  ', SWEAT_COLOR])
  if (feeling === 'sleep') {
    return beat % 2 === 0
      ? [[' Z', SLEEP_COLOR], ['z ', SLEEP_COLOR], ['  ', SLEEP_COLOR]]
      : [['Z ', SLEEP_COLOR], [' z', SLEEP_COLOR], ['  ', SLEEP_COLOR]]
  }
  if (feeling === 'cheer') {
    return beat % 2 === 0
      ? [['✦ ', SPARK_COLOR], ['  ', SPARK_COLOR], [' ✧', SPARK_COLOR]]
      : [[' ✧', SPARK_COLOR], ['✦ ', SPARK_COLOR], ['  ', SPARK_COLOR]]
  }
  return [0, 1, 2].map(row => [dust?.[row] ?? '  ', DUST_COLOR])
}

export function drawBand({ Box, Button, Text, Raster, Image }: Kit, view: BandView) {
  const { s, config, turn, feeling, beat, tick, isWorking } = view

  // Pieces of text whose widths are known, so the frame can be drawn to fit them
  type Seg = { text: string; color?: string; bold?: boolean; dim?: boolean }
  const width = (segs: Seg[]) => segs.reduce((n, seg) => n + [...seg.text].length, 0)
  const draw = (segs: Seg[]) =>
    segs.map(seg => (
      <Text color={seg.color} bold={seg.bold} dimColor={seg.dim}>{seg.text}</Text>
    ))

  const border = isWorking ? COLORS.borderBusy : feeling === 'sweat' ? COLORS.hot : COLORS.border
  const line = (text: string): Seg => ({ text, color: border })
  const total = Math.max(40, view.bodyColumns - 2 - CLAWD_WIDTH - ENGINE_MARK_WIDTH - CARD_INSET * 2)

  // Top edge: the project as the panel's title, then the model and its effort
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
  const effort = view.effort ?? s.effort
  const title: Seg[] = [
    line('╭─ '),
    { text: `◆ ${s.folder}`, color: COLORS.folder, bold: true },
    ...(s.subdir ? [{ text: s.subdir, dim: true }] : []),
    ...(g === null ? [] : [line(' ─ '), { text: g.branch, color: COLORS.branch }]),
    line(' ─ '),
    { text: `✦ ${s.model}`, color: COLORS.model },
    ...(effort ? [{ text: ` · ${effort}`, dim: true }] : []),
    ...(s.plan ? [{ text: ' · ', dim: true }, { text: s.plan, color: CLAWD_COLOR, bold: true }] : []),
    { text: ' ' },
  ]
  // Top right: what the session, today and the history window have cost, each with its tokens
  const hours = (s.now - s.startedAt) / 3_600_000
  const cost: Seg[] = []
  const costShort: Seg[] = []
  // A snapshot kept from before a reload may predate the token counts
  const counted = (s.tokens as Snapshot['tokens'] | undefined) ?? { session: 0, today: 0, rolling: 0 }
  if (s.costUsd !== null) {
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
    // Today only when it adds to the session; the history window always, even while it matches today
    if (s.todayUsd !== null && s.todayUsd - s.costUsd >= 0.01) {
      addTotal(s.todayUsd, counted.today)
      cost.push({ text: 'today', dim: true })
    }
    // The window's label is a button that opens the history pane, so it is drawn apart
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

  // Bottom edge: running subagents and git on the left; the last reply's tokens, how long the session has
  // run and the time on the right
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

  // Clawd
  const step = tick === null ? 0 : Math.floor(tick / 2)
  const pose =
    tick !== null
      ? CLAWD_RUN[step % CLAWD_RUN.length] ?? CLAWD_IDLE
      : feeling === 'cheer'
        ? CLAWD_CHEER[beat % CLAWD_CHEER.length] ?? CLAWD_IDLE
        : CLAWD_IDLE
  const blink = tick === null && (feeling === 'sleep' || view.isBlinking)
  const side = clawdSide(feeling, beat, tick === null ? undefined : DUST[step % DUST.length])
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
          {
            key: 'ctx',
            segs: [
              { text: 'ctx ', dim: true },
              { text: '━'.repeat(barCells(s.context.percent)), color: toneHex(s.context.percent) },
              { text: '━'.repeat(BAR_CELLS - barCells(s.context.percent)), dim: true },
              {
                text: ` ${Math.round(s.context.percent)}%`,
                bold: true,
                color: s.context.percent >= 50 ? toneHex(s.context.percent) : undefined,
              },
              { text: ` ${formatTokens(s.context.tokens)}/${formatTokens(s.context.window)}`, dim: true },
            ],
          },
        ]
      : []),
  ]

  // Drop the last blocks first when the terminal is too narrow for one row
  const divider: Seg = { text: '   │   ', color: border }
  const room = total - 8
  while (stats.length > 1 && stats.reduce((n, st) => n + width(st.segs) + width([divider]), 0) > room) stats.pop()

  const ctxFull = s.context !== null && s.context.percent >= COMPACT_AT
  // A snapshot kept from before a reload may predate the switches
  const gitAuto = (s.gitAuto as GitAuto | null | undefined) ?? null
  // A side of the frame, one "│" per row of the stats and their padding
  const edge = (key: string) => (
    <Box flexDirection="column">
      {Array.from({ length: config.padRows * 2 + 1 }, (_, i) => (
        <Text key={`${key}${i}`} wrap="truncate">{draw([line('│')])}</Text>
      ))}
    </Box>
  )
  // Spotify, in a card of its own framed in Spotify green, drawn like the main one and as wide, with the album art under Clawd.
  // Its top edge holds the state and the track; inside, the controls, progress with the time, and
  // shuffle, repeat and volume; its bottom edge, the track heard before this one
  const drawMusic = (m: Music) => {
    const hasArt = view.canDrawArt && Raster !== undefined && m.art !== null
    // The card makes room on its right for the album art
    const cardWidth = hasArt ? total - ART_COLUMNS - 2 : total
    const time = `${formatClock(m.positionMs)} / ${formatClock(m.durationMs)}`
    const last = m.recent[0]
    // Spotify's card is framed in Spotify green
    const line = (text: string): Seg => ({ text, color: SPOTIFY_GREEN })

    // Top edge, the track cut to fit
    const head: Seg[] = [
      line('╭─ '),
      { text: 'Spotify', color: SPOTIFY_GREEN, bold: true },
      { text: m.isPlaying ? ' · playing' : ' · paused', dim: true },
      line(' ─ '),
    ]
    const track = [m.name, m.artist ? ` — ${m.artist}` : '', m.album ? ` · ${m.album}` : '']
    const roomForTrack = Math.max(0, cardWidth - width(head) - 4)
    const trackSegs: Seg[] = []
    let used = 0
    track.forEach((part, i) => {
      const chars = [...part]
      const take = Math.min(chars.length, Math.max(0, roomForTrack - used))
      if (take <= 0) return
      const text = take < chars.length ? `${chars.slice(0, Math.max(0, take - 1)).join('')}…` : part
      used += [...text].length
      trackSegs.push(i === 0 ? { text, bold: true } : i === 1 ? { text } : { text, dim: true })
    })
    const topMusic = [...head, ...trackSegs, { text: ' ' }]
    const topLine = [...topMusic, line('─'.repeat(Math.max(1, cardWidth - width(topMusic) - 2))), line('─╮')]

    // Bottom edge: the track heard before this one
    const lastSegs: Seg[] = last
      ? [{ text: ' ' }, { text: `last: ${last.name} — ${last.artist} · ${s.now - last.at < 60_000 ? 'just now' : `${formatReset(s.now - last.at)} ago`}`, dim: true }, { text: ' ' }]
      : []
    const bottomLine = [line('╰─'), ...lastSegs, line('─'.repeat(Math.max(1, cardWidth - width(lastSegs) - 4))), line('─╯')]

    // Inside: the controls, progress and the time, then shuffle, repeat and volume on the right
    const toggles = `shuffle · repeat · vol − ${m.volume}% +`
    const cells = Math.max(10, cardWidth - 2 - 4 - 14 - (time.length + 2) - toggles.length - 4)
    const filled = m.durationMs > 0 ? Math.min(cells, Math.round((m.positionMs / m.durationMs) * cells)) : 0
    const toggle = (key: MusicCommand, label: string, isOn: boolean) => (
      <Button key={`music-${key}`} plain dimColor={!isOn} label={label} onPress={() => view.onMusic(key)} />
    )

    return (
      <Box>
        {/* Under Clawd, the Spotify logo: the pixel grid in spotify-logo.ts, or while that is empty the PNG
            as an Image, which kitty and Ghostty draw and other terminals show as its alt, the word Spotify */}
        <Box width={CLAWD_WIDTH} flexShrink={0} paddingLeft={CLAWD_BODY_FROM - 1}>
          {LOGO_CELLS && view.canDrawArt && Raster ? (
            <Raster key="spotify-logo" columns={LOGO_COLUMNS} rows={LOGO_ROWS} cells={LOGO_CELLS} />
          ) : view.logoFile && Image ? (
            <Image key="spotify-logo" source={{ file: view.logoFile, format: 'png' }} columns={LOGO_COLUMNS} rows={LOGO_ROWS} alt="Spotify" />
          ) : null}
        </Box>
        <Box flexDirection="column" backgroundColor={card} paddingX={CARD_INSET}>
          <Text wrap="truncate">{draw(topLine)}</Text>
          <Box width={cardWidth}>
            <Text wrap="truncate">{draw([line('│')])}</Text>
            <Box flexGrow={1} paddingX={2} justifyContent="space-between">
              <Box>
                <Button key="music-previous" plain label="◀◀" onPress={() => view.onMusic('previous')} />
                <Text>{'  '}</Text>
                <Button key="music-play" plain label={m.isPlaying ? '❚❚' : '▶ '} onPress={() => view.onMusic('playpause')} />
                <Text>{'  '}</Text>
                <Button key="music-next" plain label="▶▶" onPress={() => view.onMusic('next')} />
                <Text>{'    '}</Text>
                <Text wrap="truncate">
                  <Text color={SPOTIFY_GREEN}>{'━'.repeat(filled)}</Text>
                  <Text dimColor>{'━'.repeat(cells - filled)}</Text>
                  <Text dimColor>{`  ${time}`}</Text>
                </Text>
              </Box>
              <Box>
                {toggle('shuffle', 'shuffle', m.isShuffling)}
                <Text dimColor>{' · '}</Text>
                {toggle('repeat', 'repeat', m.isRepeating)}
                <Text dimColor>{' · vol '}</Text>
                <Button key="music-quieter" plain dimColor label="−" onPress={() => view.onMusic('quieter')} />
                <Text>{` ${m.volume}% `}</Text>
                <Button key="music-louder" plain dimColor label="+" onPress={() => view.onMusic('louder')} />
              </Box>
            </Box>
            <Text wrap="truncate">{draw([line('│')])}</Text>
          </Box>
          <Text wrap="truncate">{draw(bottomLine)}</Text>
        </Box>
        {/* The album art, small, on the card's right */}
        {hasArt && m.art ? (
          <Box marginLeft={1} flexShrink={0}>
            <Raster key="album-art" columns={ART_COLUMNS} rows={ART_ROWS} cells={m.art} />
          </Box>
        ) : null}
      </Box>
    )
  }

  const card = config.card || undefined

  return (
    // The whole band on the card color (none when cardColor is empty); its own edge columns are padding
    <Box paddingX={1} paddingY={1} flexDirection="column" backgroundColor={card}>
      <Box alignItems="center">
        {clawd}
        <Box flexDirection="column" backgroundColor={card} paddingX={CARD_INSET}>
          <Box>
            <Text wrap="truncate">{draw(topLeft)}</Text>
            {showFull && hasHistory && (
              <Button key="history" plain dimColor label={historyLabel} onPress={view.onHistory} />
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
                      <Box position="absolute" top={1} left={0} display="none" hover={{ display: 'flex' }} backgroundColor={card}>
                        <Text wrap="truncate">{draw(st.card)}</Text>
                      </Box>
                    )}
                  </Box>,
                ])}
              </Box>
              {ctxFull && !isWorking && (
                <Button
                  key="compact"
                  label={view.isCompacting ? 'compacting…' : 'compact'}
                  hotkey="c"
                  variant="primary"
                  onPress={view.onCompact}
                />
              )}
            </Box>
            {edge('r')}
          </Box>
          <Text wrap="truncate">{draw(bottom)}</Text>
        </Box>
      </Box>
      {/* Drawn plain, as the band's own dim text: "1: push · 2: find bugs · ...", the repo's switches on the right */}
      <Box marginLeft={INDENT} width={total - 4} justifyContent="space-between">
        <Box>
          {view.actions.flatMap((action, i) => [
            ...(i === 0 ? [] : [<Text key={`sep-${action.key}`} dimColor>{' · '}</Text>]),
            <Button
              key={`action-${action.key}`}
              plain
              dimColor
              label={action.label}
              hotkey={action.hotkey}
              onPress={() => view.onAction(action)}
            />,
          ])}
        </Box>
        {/* The repo's state, as words: "commit auto · push ask"; the label toggles, the word says which */}
        {gitAuto && (
          <Box>
            {(['commit', 'push'] as const).flatMap((step, i) => [
              ...(i === 0 ? [] : [<Text key={`switch-sep-${step}`} dimColor>{' · '}</Text>]),
              <Button key={`switch-${step}`} plain dimColor label={step} onPress={() => view.onSwitch(step)} />,
              <Text key={`switch-state-${step}`} color={gitAuto[step] ? COLORS.ok : COLORS.warn}>
                {gitAuto[step] ? ' auto' : ' ask'}
              </Text>,
            ])}
          </Box>
        )}
      </Box>
      {/* Under the actions, while Spotify plays: its own row, from the album art to the Spotify mark */}
      {view.music && <Box marginTop={1}>{drawMusic(view.music)}</Box>}
    </Box>
  )
}
