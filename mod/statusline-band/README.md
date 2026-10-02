# statusline-band

A panel above the Claude Code prompt, with Clawd, the Claude Code mascot, standing beside it.

- **Top edge:** the repo name, branch and model. On the right: the session's cost and tokens, then today's and the last 30 days'.
- **Middle:** the 5-hour and 7-day rate limits as filling rings, with the reset countdown and the local reset time. `▲ out ~7h` appears when the pace would use a limit up before it resets. Then context usage as a bar.
- **Bottom edge:** running subagents, uncommitted files and lines, unpushed commits and their lines, commits behind, stashes and the time since the last commit. On the right: the last reply's input (with its cached share) and output tokens, the session length and the time.
- **Clawd:** runs while Claude works. Otherwise it sweats while a rate limit is at 95% or more, falls asleep after 10 quiet minutes, and cheers when your commits are pushed.
- **Actions:** a row under the card sends a prompt as if you typed it: `push` (commit and push), `find bugs`, `run tests` and `summarize`. `quick commit` has Haiku write a message from the diff and shows it: commit, commit and push, or type your own; it then commits itself, without a turn of the main model. Click one, or focus the band with ctrl+x tab and press 1 to 5.
- **Git switches:** `commit auto · push ask`, kept per repo. On `ask`, Claude's `git add` or `commit`, or `push`, waits for your OK. On `auto` it runs without a prompt, but only in its plain form: `git [-C /abs/path] add <files>`, `git commit -m '…'` and `git push [remote] [branch]`, joined by `&&`, all in one repo, with nothing a shell could expand or redirect. Any other shape asks whatever the switch says: a force push, a heredoc, `$(…)`, a `cd`, a pipe, or git options before the step. When a step asks, a line under the dialog says what it takes with it. The system prompt tells Claude the plain form and where each switch stands. Click `commit` or `push` to flip it.
- **Extras:** hover a rate limit for its pace. Click `30d`, or run `/usage-history`, for a pane with each day's cost and tokens. Toasts fire when a limit passes 80% and 95%, and when its pace would run it out before the reset.

Needs Claude Code v2.1.287 or later.

## Install

```
/plugin marketplace add AsyrafHussin/claude-code-statusline
/plugin install statusline-band@claude-code-statusline
```

## Settings

Each is a row in `/config`, or run `/plugin configure statusline-band@claude-code-statusline`.

| Setting | Default | What it does |
|---------|---------|--------------|
| `initials` | empty | Up to two letters on Clawd's shirt |
| `cardColor` | `#0a0a0a` | Background of the band; empty (`""`) for none, so it takes the terminal's own |
| `padRows` | `1` | Empty rows above and below the stats, 0 to 2 |
| `historyDays` | `30` | Days the rolling cost and the history pane cover, 7 to 62 |
| `noAttribution` | `false` | Leave Co-Authored-By, Claude-Session and the Claude Code footer out of commits and pull requests |

## What it runs, reads, keeps and sends

### Programs it runs

It runs two programs, never through a shell. The arguments are fixed except the folder (each `git` command runs in the repo's folder, `git -C <folder>`) and, for quick commit, the commit message you approved.

- **`git`, read-only, to show the branch and its changes.** It runs:
  - `symbolic-ref --short HEAD` and `rev-parse --short HEAD` for the branch
  - `rev-parse --show-toplevel` for the repo name
  - `status --porcelain` and `diff --shortstat HEAD` for uncommitted files and lines
  - `rev-list --left-right --count HEAD...@{upstream}` and `diff --shortstat @{upstream}...HEAD` for commits ahead and behind, and their lines
  - `stash list` for stashes
  - `log -1 --format=%ct` for the time of the last commit

  These run every 30 seconds and after each tool call.
- **`git`, when a git step of Claude's asks**, to say under the dialog what it takes with it: `status --porcelain` and `diff --shortstat HEAD` for a commit; `rev-parse --abbrev-ref @{upstream}`, `rev-list --count @{upstream}..HEAD` and `diff --shortstat @{upstream}...HEAD` for a push.
- **`git`, when you press quick commit:** `status --porcelain`, `diff HEAD` and `log -5 --format=%s` to write the message; then, once you approve it, `add -A`, `commit -q -m <message>` and, if you chose it, `push`.
- **`date`, to read the local date and time** (`+%Y-%m-%d`, and `+%Y-%m-%d|%I:%M %p|%H|%M|%S`). It also formats a rate limit's reset moment in your timezone (`date -r <epoch>`).

### What it reads

- **From the session:** the usage Claude Code reports (cost, context, rate limits and when they reset), the model's name, the session id and working folder, the subagents that are running, and the token counts at the end of each turn.
- **What it never reads:** the text of your prompts, Claude's replies or tool calls.

### What it keeps

All of it stays in the plugin's own store on your machine, nothing else:

- each repo's git switches, by the repo's root

- each day's cost and tokens, for the last 62 days
- each session's last reading, for the last 100 sessions
- rate-limit readings from the last 3 hours, used for the recent pace
- which toasts it has already shown

### What it sends

- **Prompts to Claude, only when you press an action.** Each is the fixed text listed under Actions, sent to this session as if you typed it. A push still goes through your own permission rules.
- **The diff to Haiku, only when you press quick commit.** Up to 24k characters of the diff, the names of new files and the last five commit subjects go to Claude's small model through Claude Code's own model call, the same way Claude Code itself talks to the model, to write the message.
- **A push, only when you choose "Commit and push" in quick commit.** It runs `git push` itself, to the branch's upstream, with the git credentials you already have.
- **Nothing else.** It never fetches, makes no other network calls, has no telemetry, and sends nothing to any other service. Commits behind are counted against the remote as of your own last fetch or pull.

### Hooks

- **`tool.call`:** only notes the time and refreshes the panel after the call. It lets every call run unchanged and never blocks or rewrites one.
- **`prompt.submit`:** starts Clawd's running animation. The prompt passes through unchanged.
- **`turn.complete`:** stops the animation and adds the turn's token counts to the totals.
- **`session.start`:** starts the panel's timers and registers `/usage-history`.
- **`command.run`:** answers only its own `/usage-history` command, by opening the history pane.
- **`attribution.text`:** with `noAttribution` on, answers an empty commit trailer and PR footer.
- **`prompt.compose`:** adds one section to the system prompt: the git plain form, where each switch stands, and (with `noAttribution`) no credit lines.
- **Action buttons:** pressing one calls `$.prompt.submit` with its fixed prompt; nothing is sent without a press. `quick commit` instead sends the diff (up to 24k characters) and the last five commit subjects to Haiku through Claude Code's own model call, then runs `git add -A`, `git commit -m` and, if you choose it, `git push` itself.
- **`classic.PreToolUse` (Bash only):** runs the hooks beneath it first (your own settings hooks among them; their ask or deny stands), then reads the command as it will run for `git add`, `commit` and `push`, and answers ask or allow by the repo's switches. Any other command passes on to your usual permissions untouched.
- **`ui.render`:** draws the panel above the prompt (`AbovePrompt`) and the history pane (`Pane`).
