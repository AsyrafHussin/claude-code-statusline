import { describe, expect, test } from 'claude-code/testing'

import {
  barCells,
  dayLabel,
  formatReset,
  formatTokens,
  placeFolder,
  prettyModel,
  readConfig,
  runsOutIn,
  shiftDay,
  shirtText,
  sumDays,
} from './logic'

const HOUR = 3_600_000
const MINUTE = 60_000

describe('runsOutIn', () => {
  // 95% of the 7-day window used, 33 hours before the reset: 135 hours in
  test('uses the pace across the window', () => {
    const out = runsOutIn('seven_day', 95, 33 * HOUR)
    expect(Math.round((out ?? 0) / HOUR)).toBe(7)
  })

  test('takes a faster recent pace over the window pace', () => {
    const out = runsOutIn('seven_day', 95, 33 * HOUR, 1 / HOUR)
    expect(Math.round((out ?? 0) / HOUR)).toBe(5)
  })

  test('keeps the window pace when the recent one is slower', () => {
    const slow = runsOutIn('seven_day', 95, 33 * HOUR, 0.1 / HOUR)
    expect(slow).toBe(runsOutIn('seven_day', 95, 33 * HOUR))
  })

  test('says nothing when the limit lasts until the reset', () => {
    expect(runsOutIn('five_hour', 49, 49 * MINUTE)).toBeUndefined()
  })

  test('says nothing too early in a window', () => {
    // 5% of 5 hours is 15 minutes; 10 minutes in is too soon
    expect(runsOutIn('five_hour', 30, 5 * HOUR - 10 * MINUTE)).toBeUndefined()
  })

  test('says nothing for a window it does not know, or at 0% or 100%', () => {
    expect(runsOutIn('spend_limit', 90, HOUR)).toBeUndefined()
    expect(runsOutIn('seven_day', 0, 33 * HOUR)).toBeUndefined()
    expect(runsOutIn('seven_day', 100, 33 * HOUR)).toBeUndefined()
  })
})

describe('days', () => {
  test('steps back across months and years', () => {
    expect(shiftDay('2026-10-02', -29)).toBe('2026-09-03')
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29')
  })

  test('labels a day', () => {
    expect(dayLabel('2026-10-02')).toBe('Fri 02 Oct')
  })

  test('sums a ledger over the last 30 days, both ends included', () => {
    const days = { '2026-09-02': 100, '2026-09-03': 1, '2026-09-30': 2, '2026-10-02': 10, '2026-10-03': 999 }
    expect(sumDays(days, shiftDay('2026-10-02', -29), '2026-10-02')).toBe(13)
  })
})

describe('formatting', () => {
  test('reset times', () => {
    expect(formatReset(33 * HOUR)).toBe('1d9h')
    expect(formatReset(4 * HOUR + 4 * MINUTE)).toBe('4h4m')
    expect(formatReset(49 * MINUTE)).toBe('49m')
  })

  test('tokens', () => {
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1500)).toBe('2k')
    expect(formatTokens(2_400_000)).toBe('2.4m')
  })

  test('model ids', () => {
    expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(prettyModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(prettyModel('some-other-model')).toBe('some-other-model')
  })

  test('bar cells show any use and never overflow', () => {
    expect(barCells(0)).toBe(0)
    expect(barCells(1)).toBe(1)
    expect(barCells(100)).toBe(8)
    expect(barCells(150)).toBe(8)
  })
})

describe('settings', () => {
  test('initials fill the shirt, or leave it plain', () => {
    expect(shirtText('ah')).toBe(' A H ')
    expect(shirtText('A')).toBe(' A   ')
    expect(shirtText('')).toBe('     ')
    expect(shirtText('xyz')).toBe(' X Y ')
  })

  test('clamps numbers and falls back on missing values', () => {
    expect(readConfig({ padRows: 9, historyDays: 3 })).toEqual({
      initials: '',
      card: '#0a0a0a',
      padRows: 2,
      rollingDays: 7,
    })
    expect(readConfig({ initials: 'AH', cardColor: '#000000' })).toMatchObject({ initials: 'AH', card: '#000000' })
  })

  test('names the repo, with the subfolder apart', () => {
    expect(placeFolder('/code/repo/mod/x', '/code/repo')).toEqual({ folder: 'repo', subdir: '/mod/x' })
    expect(placeFolder('/code/repo', '/code/repo')).toEqual({ folder: 'repo', subdir: '' })
    expect(placeFolder('/tmp/elsewhere', null)).toEqual({ folder: 'elsewhere', subdir: '' })
  })
})
