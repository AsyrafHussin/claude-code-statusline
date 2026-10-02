// The band's widths, kept apart from the drawing so tests can hold them to the card: each frame edge
// must come out exactly as wide as its card, and nothing inside may need more room than it has.
// band.tsx draws with these same pieces, so a test of their widths is a test of what shows

// Columns of a piece of text as the terminal draws it (every character here is one column wide)
export const columnsOf = (text: string) => [...text].length

// Clawd's column, and Beatbot's under it: the box, and Beatbot's grid with the one column left of it
export const CLAWD_WIDTH = 11
export const BEATBOT_PAD = 1
// How long a track stays paused before Beatbot falls asleep
export const BEATBOT_SLEEP_MS = 10 * 60_000

// The end of a card's bottom edge, after what it shows: the button that shrinks the card, then the corner.
// On the main card a dot parts it from the time
export const MINIMIZE_LABEL = 'minimize'
export const MAIN_BOTTOM_TAIL = ['· ', MINIMIZE_LABEL, ' ─╯']
export const MUSIC_BOTTOM_TAIL = [' ', MINIMIZE_LABEL, ' ─╯']
const BOTTOM_HEAD = '╰─'
const tailColumns = (tail: string[]) => tail.reduce((n, piece) => n + columnsOf(piece), 0)

// The rule between what a bottom edge shows on its left and right, so the edge spans the card
export const bottomFill = (cardWidth: number, shown: number, tail: string[]) =>
  Math.max(1, cardWidth - columnsOf(BOTTOM_HEAD) - shown - tailColumns(tail))

// The Spotify card's middle row: the controls, then (room allowing) the progress bar and the time, then
// shuffle, repeat and volume on the right. As the card narrows the toggles go first, then the bar, then
// the time, so nothing wraps
export const CONTROL_PIECES = ['◀◀', '  ', '❚❚', '  ', '▶▶', '   ', 'search']
const CONTROLS = CONTROL_PIECES.reduce((n, piece) => n + columnsOf(piece), 0)
// The frame's sides and the row's padding on each side
export const MUSIC_ROW_CHROME = 2 + 4
export const BEFORE_BAR = '    '
export const BEFORE_TIME = '  '
// The least room between the left group and the toggles, and the shortest bar worth drawing
const TOGGLE_GAP = 3
const MIN_BAR = 8

export const musicRow = (cardWidth: number, timeColumns: number, toggleColumns: number) => {
  const inner = cardWidth - MUSIC_ROW_CHROME
  const withTime = CONTROLS + columnsOf(BEFORE_BAR) + timeColumns
  const withBar = withTime + MIN_BAR + columnsOf(BEFORE_TIME)
  const hasToggles = inner >= withBar + TOGGLE_GAP + toggleColumns
  const hasBar = inner >= withBar
  const hasTime = inner >= withTime
  const bar = hasBar ? inner - withTime - columnsOf(BEFORE_TIME) - (hasToggles ? TOGGLE_GAP + toggleColumns : 0) : 0
  // What the row takes, for the tests: it may never pass `inner`
  const used =
    CONTROLS +
    (hasTime ? withTime - CONTROLS : 0) +
    (hasBar ? bar + columnsOf(BEFORE_TIME) : 0) +
    (hasToggles ? TOGGLE_GAP + toggleColumns : 0)
  return { hasToggles, hasBar, hasTime, bar, inner, used }
}
