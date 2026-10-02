import { describe, expect, test } from 'claude-code/testing'

import {
  barCells,
  cleanCommitMessage,
  gitGuide,
  dayLabel,
  formatReset,
  formatTokens,
  gitDecision,
  looseGitSteps,
  parsePlainGit,
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
      noAttribution: false,
    })
    expect(readConfig({ initials: 'AH', cardColor: '#000000' })).toMatchObject({ initials: 'AH', card: '#000000' })
  })

  test('names the repo, with the subfolder apart', () => {
    expect(placeFolder('/code/repo/mod/x', '/code/repo')).toEqual({ folder: 'repo', subdir: '/mod/x' })
    expect(placeFolder('/code/repo', '/code/repo')).toEqual({ folder: 'repo', subdir: '' })
    expect(placeFolder('/tmp/elsewhere', null)).toEqual({ folder: 'elsewhere', subdir: '' })
  })
})

describe('git switches', () => {
  const all = { commit: true, push: true }
  const none = { commit: false, push: false }
  const decide = (command: string, auto: { commit: boolean; push: boolean }) =>
    gitDecision(parsePlainGit(command), looseGitSteps(command), auto)

  test('reads the plain forms', () => {
    expect(parsePlainGit("git add -A && git commit -m 'fix: a thing' && git push")).toEqual({
      steps: ['commit', 'push'],
      dir: undefined,
    })
    expect(parsePlainGit('git -C /code/repo push -u origin main')).toEqual({ steps: ['push'], dir: '/code/repo' })
    expect(parsePlainGit("git -C /code/repo commit -q -m 'line one\n\nline two'")).toEqual({
      steps: ['commit'],
      dir: '/code/repo',
    })
  })

  test('allows a plain command only with every step on auto', () => {
    expect(decide('git push', all)).toBe('allow')
    expect(decide('git push', none)).toBe('ask')
    expect(decide("git add . && git commit -m 'x'", { commit: true, push: false })).toBe('allow')
    expect(decide("git add . && git commit -m 'x' && git push", { commit: true, push: false })).toBe('ask')
    expect(decide('ls -la', none)).toBe('pass')
    expect(decide("grep -rn 'git push' README.md", none)).toBe('pass')
  })

  // Each shape below once slipped past as "only git"; now none is plain, so each asks even on auto
  test('anything beyond plain git asks, even on auto', () => {
    for (const command of [
      "git commit -F - <<'EOF' && rm -rf ~/x\nmsg\nEOF",
      'git commit -F - <<EOF\n$(touch /tmp/pwn)\nEOF',
      'git push && rm -rf build',
      'git commit -m "$(cat notes)" && git push',
      'R=/code/repo; git -C $R push',
      'git push > /tmp/out',
      'git -c core.hooksPath=/tmp/h commit -m x',
      'git push --receive-pack=/tmp/evil origin',
      'git diff --output=/tmp/o && git add .',
      'cd /other; git push',
      "git add . && cd /other && git push",
      "git -C /a commit -m 'x' && git -C /b push",
      'cd ~/repo && git push',
      'git --no-pager push origin main',
      'sh -c "git push"',
    ]) {
      expect(decide(command, all)).toBe('ask')
    }
  })

  test('a force push always asks, in every spelling', () => {
    for (const command of [
      'git push --force',
      'git push -f origin main',
      'git push -uf origin main',
      'git push -fu',
      'git push --force-with-lease',
      'git push --force-w origin main',
      'git push --mirror',
      'git push origin +main',
      "git push origin '+main'",
      'git push origin main:other',
      'git push \\\n  --force',
    ]) {
      expect(decide(command, all)).toBe('ask')
    }
  })

  test('reading steps ride along without asking', () => {
    expect(decide('git -C /a push && git -C /a log --oneline -1', all)).toBe('allow')
    expect(decide("git add . && git commit -m 'x' && git status --short", { commit: true, push: false })).toBe('allow')
    expect(decide('git status && git diff --stat', none)).toBe('pass')
    expect(decide('git diff --output=/tmp/o && git push', all)).toBe('ask')
    expect(decide('git log --ext-diff && git push', all)).toBe('ask')
  })

  test('a repo path is absolute and plain, the same for every step', () => {
    expect(parsePlainGit('git -C repo push')).toBe(null)
    expect(parsePlainGit("git -C '/code/my repo' push")).toBe(null)
    expect(parsePlainGit('git -C /a add . && git -C /a push')).toEqual({ steps: ['commit', 'push'], dir: '/a' })
    expect(parsePlainGit('git -C /a add . && git push')).toBe(null)
  })
})

describe('commit messages', () => {
  test('drops fences, quotes, credit lines and apostrophes', () => {
    const written = "```\nfix: keep the switch state\n\nThe refresh wrote it back. It's fixed now.\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/x\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n```"
    expect(cleanCommitMessage(written)).toBe('fix: keep the switch state\n\nThe refresh wrote it back. Its fixed now.')
    expect(cleanCommitMessage('"feat: add a thing"')).toBe('feat: add a thing')
  })

  test('keeps a co-author who is not Claude', () => {
    expect(cleanCommitMessage('feat: x\n\nCo-Authored-By: Ali <ali@example.com>')).toBe('feat: x\n\nCo-Authored-By: Ali <ali@example.com>')
  })
})

describe('git guide', () => {
  test('names the plain form and each switch, and the credit rule only when asked', () => {
    const guide = gitGuide('/code/repo', { commit: true, push: false }, true)
    expect(guide.includes('git -C /code/repo commit')).toBe(true)
    expect(guide.includes('commit is auto')).toBe(true)
    expect(guide.includes('push is ask')).toBe(true)
    expect(guide.includes('Co-Authored-By')).toBe(true)
    expect(gitGuide('/code/repo', { commit: true, push: true }, false).includes('Co-Authored-By')).toBe(false)
  })
})

