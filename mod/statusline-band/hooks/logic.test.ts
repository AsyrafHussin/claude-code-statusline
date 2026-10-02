import { describe, expect, test } from 'claude-code/testing'

import {
  aliasSteps,
  barCells,
  cleanCommitMessage,
  gitGuide,
  dayLabel,
  formatClock,
  formatReset,
  formatTokens,
  fromBase64,
  gitDecision,
  isSensitivePath,
  withoutDataHeredocs,
  looseGitSteps,
  parsePlainGit,
  addPlayed,
  parseSpotify,
  pixelsToCells,
  readBmp,
  parseShortstat,
  parseStatusV2,
  placeFolder,
  planLabel,
  prettyModel,
  readConfig,
  runsOutIn,
  shiftDay,
  shirtText,
  sumDays,
  toBase64,
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
      gitStrict: true,
      spotify: true,
      plan: '',
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
  const decide = (command: string, auto: { commit: boolean; push: boolean }, mode?: string) => {
    const plain = parsePlainGit(command)
    return gitDecision(plain, plain?.steps ?? looseGitSteps(command).steps, auto, mode)
  }

  test('reads the plain forms', () => {
    expect(parsePlainGit("git -C /r add -A && git -C /r commit -m 'fix: a thing' && git -C /r push")).toEqual({
      steps: ['commit', 'push'],
      dir: '/r',
    })
    expect(parsePlainGit('git -C /code/repo push -u origin main')).toEqual({ steps: ['push'], dir: '/code/repo' })
    expect(parsePlainGit("git -C /code/repo commit -q -m 'line one\n\nline two'")).toEqual({
      steps: ['commit'],
      dir: '/code/repo',
    })
  })

  test('allows only a plain command that names its repo, with every step on auto', () => {
    expect(decide('git -C /r push', all)).toBe('allow')
    expect(decide('git -C /r push', none)).toBe('ask')
    expect(decide("git -C /r add . && git -C /r commit -m 'x'", { commit: true, push: false })).toBe('allow')
    expect(decide("git -C /r add . && git -C /r commit -m 'x' && git -C /r push", { commit: true, push: false })).toBe('ask')
    expect(decide('ls -la', none)).toBe('pass')
    expect(decide("grep -rn 'git push' README.md", none)).toBe('pass')
  })

  // The Bash tool keeps its own folder between calls, so a step that does not name its repo may act on
  // another repo than the session's: it asks even on auto
  test('a step without -C asks even on auto', () => {
    expect(decide('git push', all)).toBe('ask')
    expect(decide("git add . && git commit -m 'x'", all)).toBe('ask')
  })

  test('nothing is allowed in plan mode', () => {
    expect(decide('git -C /r push', all, 'plan')).toBe('pass')
    expect(decide('git -C /r push', all, 'bypassPermissions')).toBe('allow')
  })

  test('a quoted repo path may hold spaces and letters beyond ASCII', () => {
    expect(parsePlainGit("git -C '/Users/x/My Projects/app' push")).toEqual({ steps: ['push'], dir: '/Users/x/My Projects/app' })
    expect(parsePlainGit("git -C '/Users/x/Développement/app' add 'docs/read me.md'")).toEqual({
      steps: ['commit'],
      dir: '/Users/x/Développement/app',
    })
    expect(parsePlainGit('git -C repo push')).toBe(null)
    expect(parsePlainGit('git -C /a add . && git push')).toBe(null)
  })

  // Each shape below once slipped past as "only git"; now none is plain, so each asks even on auto
  test('anything beyond plain git asks, even on auto', () => {
    for (const command of [
      "git commit -F - <<'EOF' && rm -rf ~/x\nmsg\nEOF",
      'git commit -F - <<EOF\n$(touch /tmp/pwn)\nEOF',
      'git -C /r push && rm -rf build',
      'git commit -m "$(cat notes)" && git push',
      'R=/code/repo; git -C $R push',
      'git -C /r push > /tmp/out',
      'git -c core.hooksPath=/tmp/h commit -m x',
      'git -C /r push --receive-pack=/tmp/evil origin',
      'git -C /r diff --output=/tmp/o && git -C /r add .',
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
      'git -C /r push --force',
      'git -C /r push -f origin main',
      'git -C /r push -uf origin main',
      'git -C /r push -fu',
      'git -C /r push --force-with-lease',
      'git -C /r push --force-w origin main',
      'git -C /r push --mirror',
      'git -C /r push origin +main',
      "git -C /r push origin '+main'",
      'git -C /r push origin main:other',
      'git -C /r push \\\n  --force',
    ]) {
      expect(decide(command, all)).toBe('ask')
    }
  })

  test('reading steps ride along without asking', () => {
    expect(decide('git -C /a push && git -C /a log --oneline -1', all)).toBe('allow')
    expect(decide("git -C /a add . && git -C /a commit -m 'x' && git -C /a status --short", { commit: true, push: false })).toBe('allow')
    expect(decide('git status && git diff --stat', none)).toBe('pass')
    expect(decide('git -C /a diff --output=/tmp/o && git -C /a push', all)).toBe('ask')
    expect(decide('git -C /a log --ext-diff && git -C /a push', all)).toBe('ask')
  })

  // Each of these once went unseen, so the hook never looked at it
  test('sees a step behind a wrapper, a path, quotes or git options', () => {
    for (const command of [
      'env git push',
      'command git push',
      'FOO=1 git push',
      'time git push',
      'xargs git push',
      'env -C /other git push',
      'timeout 30 git push',
      'sudo -u me git push',
      '/usr/bin/git push',
      '"git" push',
      '\\git push',
      'git --git-dir /x/.git push',
      'git --namespace foo push',
      "sh -c 'cd /other && git push --force'",
      '"cd" /other && git push',
      'eval "git push"',
    ]) {
      expect(looseGitSteps(command).steps).toEqual(['push'])
    }
    expect(looseGitSteps('env git commit -m x').steps).toEqual(['commit'])
  })

  test('a heredoc fed to a program is data; one fed to a shell is run', () => {
    expect(looseGitSteps("python3 - <<'PY'\ns.replace('`push [remote]`', x)\nprint('git push')\nPY").steps).toEqual([])
    expect(looseGitSteps('cat <<EOF > notes.md\ngit commit -m x\nEOF').steps).toEqual([])
    expect(looseGitSteps('bash <<EOF\ngit push\nEOF').steps).toEqual(['push'])
    expect(looseGitSteps("sh -s <<'EOF'\ngit push --force\nEOF").steps).toEqual(['push'])
    expect(looseGitSteps("git commit -F - <<'EOF'\nmsg mentions git push\nEOF").steps).toEqual(['commit'])
    expect(withoutDataHeredocs("python3 - <<'PY'\nbody\nPY")).toBe('python3 - <<HEREDOC')
  })

  test('names words that may be aliases, and reads what an alias does', () => {
    expect(looseGitSteps('git ci -m x').aliases).toEqual(['ci'])
    expect(looseGitSteps('git status && git log').aliases).toEqual([])
    expect(aliasSteps('commit -v')).toEqual(['commit'])
    expect(aliasSteps('push --follow-tags')).toEqual(['push'])
    expect(aliasSteps('!git add -A && git commit')).toEqual(['commit', 'push'])
    expect(aliasSteps('log --oneline')).toEqual([])
  })
})

describe('git status', () => {
  test('reads branch, upstream, ahead and behind, stashes and changed paths in one go', () => {
    const text = [
      '# branch.oid 02cf6fbe9828eabb8d55138973d0ebf48cd48914',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +3 -1',
      '# stash 2',
      '1 .M N... 100644 100644 100644 abc abc README.md',
      '? new.txt',
      '! ignored.log',
    ].join('\n')
    expect(parseStatusV2(text)).toEqual({ branch: 'main', upstream: 'origin/main', ahead: 3, behind: 1, stashed: 2, changed: 2 })
  })

  test('a detached head shows its short commit, a new repo none', () => {
    expect(parseStatusV2('# branch.oid 02cf6fbe98\n# branch.head (detached)').branch).toBe('02cf6fb')
    expect(parseStatusV2('# branch.oid (initial)\n# branch.head main').branch).toBe('main')
    expect(parseStatusV2('# branch.oid 02cf6fb\n# branch.head main').upstream).toBe(null)
  })

  test('reads shortstat lines', () => {
    expect(parseShortstat(' 3 files changed, 12 insertions(+), 4 deletions(-)')).toEqual({ added: 12, removed: 4 })
    expect(parseShortstat('')).toEqual({ added: 0, removed: 0 })
  })

  test('tells paths that may hold secrets', () => {
    for (const path of ['.env', 'app/.env.local', 'id_rsa', 'certs/server.pem', 'config/credentials.json', '.npmrc']) {
      expect(isSensitivePath(path)).toBe(true)
    }
    for (const path of ['README.md', 'src/env.ts', 'environment.md']) {
      expect(isSensitivePath(path)).toBe(false)
    }
  })
})

describe('commit messages', () => {
  test('drops fences, quotes and credit lines, and keeps apostrophes', () => {
    const written = "```\nfix: keep the switch state\n\nThe refresh wrote it back. It's fixed now.\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/x\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n```"
    expect(cleanCommitMessage(written)).toBe("fix: keep the switch state\n\nThe refresh wrote it back. It's fixed now.")
    expect(cleanCommitMessage('"feat: add a thing"')).toBe('feat: add a thing')
  })

  test('keeps a co-author who is not Claude', () => {
    expect(cleanCommitMessage('feat: x\n\nCo-Authored-By: Ali <ali@example.com>')).toBe('feat: x\n\nCo-Authored-By: Ali <ali@example.com>')
  })
})

describe('git guide', () => {
  test('names the plain form and each switch, and the credit rule only when asked', () => {
    const guide = gitGuide('/code/repo', { commit: true, push: false }, true)
    expect(guide.includes("git -C '/code/repo' commit")).toBe(true)
    expect(guide.includes('commit is auto')).toBe(true)
    expect(guide.includes('push is ask')).toBe(true)
    expect(guide.includes('Commit on your own')).toBe(true)
    expect(guide.includes('Push only when the user asks')).toBe(true)
    expect(guide.includes('Co-Authored-By')).toBe(true)
    expect(gitGuide('/code/repo', { commit: true, push: true }, false).includes('Co-Authored-By')).toBe(false)
  })

  test('auto means on its own, ask means only when asked', () => {
    const both = gitGuide('/code/repo', { commit: true, push: true }, false)
    expect(both.includes('Commit on your own')).toBe(true)
    expect(both.includes('Push on your own, right after each commit')).toBe(true)
    const neither = gitGuide('/code/repo', { commit: false, push: false }, false)
    expect(neither.includes('Commit only when the user asks')).toBe(true)
    expect(neither.includes('Push only when the user asks')).toBe(true)
  })

  test('quotes the repo path, and says so when it cannot', () => {
    expect(gitGuide('/Users/x/My Projects/app', { commit: true, push: true }, false).includes("git -C '/Users/x/My Projects/app' push")).toBe(true)
    expect(gitGuide("/Users/x/it's", { commit: true, push: true }, false).includes('cannot name it')).toBe(true)
  })
})


describe('spotify', () => {
  const S = '\x1f'
  test('reads what is playing', () => {
    const text = ['playing', 'Bohemian Rhapsody', 'Queen', 'A Night at the Opera', '354000', '61,5', 'https://i.scdn.co/image/x', 'spotify:track:1', 'true', 'false', '65'].join(S)
    expect(parseSpotify(`${text}\n`)).toEqual({
      isPlaying: true,
      name: 'Bohemian Rhapsody',
      artist: 'Queen',
      album: 'A Night at the Opera',
      durationMs: 354000,
      positionMs: 61500,
      artUrl: 'https://i.scdn.co/image/x',
      trackId: 'spotify:track:1',
      isShuffling: true,
      isRepeating: false,
      volume: 65,
    })
    expect(parseSpotify(['stopped', '', '', '', '0', '0', '', ''].join(S))).toBe(null)
    expect(parseSpotify('')).toBe(null)
  })

  test('keeps recently played tracks newest first, each once', () => {
    const a = { trackId: 'a', name: 'A', artist: 'X', at: 1 }
    const b = { trackId: 'b', name: 'B', artist: 'Y', at: 2 }
    expect(addPlayed([a], b).map(t => t.trackId)).toEqual(['b', 'a'])
    expect(addPlayed([b, a], { ...a, at: 3 }).map(t => t.trackId)).toEqual(['a', 'b'])
    expect(addPlayed([a, b], { trackId: 'c', name: 'C', artist: 'Z', at: 4 }, 2).map(t => t.trackId)).toEqual(['c', 'a'])
  })

  test('formats a clock', () => {
    expect(formatClock(67_000)).toBe('1:07')
    expect(formatClock(3_727_000)).toBe('1:02:07')
  })

  test('base64 both ways', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 7])
    expect(toBase64(bytes)).toBe('AAEC+vv8Bw==')
    expect([...fromBase64('AAEC+vv8Bw==')]).toEqual([0, 1, 2, 250, 251, 252, 7])
  })

  test('reads a bottom-up 24-bit BMP, top row first', () => {
    // 2x2: bottom row red, green; top row blue, white; rows padded to 8 bytes
    const header = new Uint8Array(54)
    const view = new DataView(header.buffer)
    header[0] = 0x42
    header[1] = 0x4d
    view.setUint32(10, 54, true)
    view.setInt32(18, 2, true)
    view.setInt32(22, 2, true)
    view.setUint16(28, 24, true)
    const rows = [0, 0, 255, 0, 255, 0, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0]
    const bmp = new Uint8Array([...header, ...rows])
    expect(readBmp(bmp)).toEqual({ width: 2, height: 2, pixels: [0x0000ff, 0xffffff, 0xff0000, 0x00ff00] })
    expect(readBmp(new Uint8Array([1, 2, 3]))).toBe(null)
  })

  test('draws two pixels a cell, the upper as ink', () => {
    const cells = pixelsToCells({ width: 1, height: 2, pixels: [0x112233, 0x445566] }, 1, 1)
    const words = new Uint32Array(fromBase64(cells).buffer)
    expect([...words]).toEqual([0x2580, 0x112233, 0x445566])
  })
})

describe('plan', () => {
  const config = (type: string, tier: string) =>
    JSON.stringify({ oauthAccount: { organizationType: type, organizationRateLimitTier: tier, emailAddress: 'x' } })
  test('names the plan from the account', () => {
    expect(planLabel(config('claude_max', 'default_claude_max_5x'))).toBe('Max 5x')
    expect(planLabel(config('claude_max', 'default_claude_max_20x'))).toBe('Max 20x')
    expect(planLabel(config('claude_pro', ''))).toBe('Pro')
    expect(planLabel(config('claude_team', ''))).toBe('Team')
    expect(planLabel(config('something_else', ''))).toBe(null)
    expect(planLabel('{}')).toBe(null)
    expect(planLabel('not json')).toBe(null)
  })
})

