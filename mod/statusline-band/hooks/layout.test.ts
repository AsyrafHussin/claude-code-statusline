import { describe, expect, test } from 'claude-code/testing'
import {
  BEATBOT_PAD,
  CLAWD_WIDTH,
  CONTROL_PIECES,
  MAIN_BOTTOM_TAIL,
  MUSIC_BOTTOM_TAIL,
  bottomFill,
  columnsOf,
  musicRow,
} from './layout'
import { LOGO_COLUMNS } from './spotify-logo'

// Card widths from a narrow split pane to a wide screen
const WIDTHS = Array.from({ length: 221 }, (_, i) => 40 + i)
const sum = (pieces: string[]) => pieces.reduce((n, piece) => n + columnsOf(piece), 0)

describe('band layout', () => {
  test('the main bottom edge spans the card exactly, minimize and corner included', () => {
    for (const total of WIDTHS) {
      for (const shown of [0, 20, 60]) {
        if (total < shown + 20) continue
        const fill = bottomFill(total, shown, MAIN_BOTTOM_TAIL)
        expect(2 + shown + fill + sum(MAIN_BOTTOM_TAIL)).toBe(total)
      }
    }
  })

  test('the Spotify bottom edge spans the card exactly', () => {
    for (const total of WIDTHS) {
      for (const shown of [0, 35]) {
        if (total < shown + 20) continue
        expect(2 + shown + bottomFill(total, shown, MUSIC_BOTTOM_TAIL) + sum(MUSIC_BOTTOM_TAIL)).toBe(total)
      }
    }
  })

  test('both edges end in the same corner, after minimize', () => {
    expect(MAIN_BOTTOM_TAIL.slice(1)).toEqual(MUSIC_BOTTOM_TAIL.slice(1))
    expect(MAIN_BOTTOM_TAIL[2]?.endsWith('─╯')).toBe(true)
  })

  test('the Spotify middle row never needs more room than the card has', () => {
    const toggles = columnsOf('shuffle · repeat · vol − 100% +')
    const time = columnsOf('59:59 / 59:59')
    for (const total of WIDTHS) {
      const row = musicRow(total, time, toggles)
      expect(row.used <= row.inner).toBe(true)
      // What goes, goes in order: the toggles before the bar, the bar before the time
      if (row.hasToggles) expect(row.hasBar).toBe(true)
      if (row.hasBar) expect(row.hasTime).toBe(true)
      // With the toggles shown, the row fills the card to the column
      if (row.hasToggles) expect(row.used).toBe(row.inner)
    }
  })

  test('a wide card shows everything, a narrow one sheds the toggles first', () => {
    const toggles = columnsOf('shuffle · repeat · vol − 84% +')
    const time = columnsOf('2:47 / 3:51')
    expect(musicRow(160, time, toggles).hasToggles).toBe(true)
    const narrow = musicRow(60, time, toggles)
    expect(narrow.hasToggles).toBe(false)
    expect(narrow.hasTime).toBe(true)
  })

  test('the controls count every piece band.tsx draws', () => {
    expect(CONTROL_PIECES.join('')).toBe('◀◀  ❚❚  ▶▶   search')
  })

  test('Beatbot fits in the column under Clawd', () => {
    expect(BEATBOT_PAD + LOGO_COLUMNS <= CLAWD_WIDTH).toBe(true)
  })
})
