# statusline-band

A panel above the Claude Code prompt, with Clawd, the Claude Code mascot, standing beside it.

- **Top edge:** the repo name, branch and model. On the right: the session's cost and tokens, then today's and the last 30 days'.
- **Middle:** the 5-hour and 7-day rate limits as filling rings, with the reset countdown and the local reset time. `▲ out ~7h` appears when the pace would use a limit up before it resets. Then context usage as a bar.
- **Bottom edge:** running subagents, uncommitted files and lines, unpushed commits and their lines, commits behind, stashes and the time since the last commit. On the right: the last reply's input (with its cached share) and output tokens, the session length and the time.
- **Clawd:** runs while Claude works. Otherwise it sweats while a rate limit is at 95% or more, falls asleep after 10 quiet minutes, and cheers when your commits are pushed.
- **Actions:** a row under the card sends a prompt as if you typed it: `push` (commit and push), `find bugs`, `run tests` and `summarize`. Click one, or focus the band with ctrl+x tab and press 1 to 4.
- **Git switches:** `commit auto · push ask`, kept per repo. On `ask`, Claude's `git add` or `commit`, or `push`, waits for your OK. On `auto` it runs without a prompt, but only when the command is nothing but git. A force push always asks, and so does a git step whose repo the band cannot be sure of. Click `commit` or `push` to flip it.
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
| `cardColor` | `#0a0a0a` | Background of the card |
| `padRows` | `1` | Empty rows above and below the stats, 0 to 2 |
| `historyDays` | `30` | Days the rolling cost and the history pane cover, 7 to 62 |

## What it runs, reads, keeps and sends

### Programs it runs

It runs two programs, always with fixed arguments and never through a shell. The only thing that varies is the folder: each `git` command runs in the session's working folder (`git -C <folder>`).

- **`git`, read-only, to show the branch and its changes.** It runs:
  - `symbolic-ref --short HEAD` and `rev-parse --short HEAD` for the branch
  - `rev-parse --show-toplevel` for the repo name
  - `status --porcelain` and `diff --shortstat HEAD` for uncommitted files and lines
  - `rev-list --left-right --count HEAD...@{upstream}` and `diff --shortstat @{upstream}...HEAD` for commits ahead and behind, and their lines
  - `stash list` for stashes
  - `log -1 --format=%ct` for the time of the last commit

  These run every 30 seconds and after each tool call.
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
- **Nothing else.** It makes no network calls, never fetches from git remotes, reads no credentials, has no telemetry, and sends nothing to any service. Commits behind are counted against the remote as of your own last fetch or pull.

### Hooks

- **`tool.call`:** only notes the time and refreshes the panel after the call. It lets every call run unchanged and never blocks or rewrites one.
- **`prompt.submit`:** starts Clawd's running animation. The prompt passes through unchanged.
- **`turn.complete`:** stops the animation and adds the turn's token counts to the totals.
- **`session.start`:** starts the panel's timers and registers `/usage-history`.
- **`command.run`:** answers only its own `/usage-history` command, by opening the history pane.
- **Action buttons:** pressing one calls `$.prompt.submit` with its fixed prompt; nothing is sent without a press.
- **`classic.PreToolUse` (Bash only):** reads a command for `git add`, `commit` and `push`, and answers ask or allow by the repo's switches. Any other command passes on to your usual permissions untouched.
- **`ui.render`:** draws the panel above the prompt (`AbovePrompt`) and the history pane (`Pane`).
