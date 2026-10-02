# statusline-band

A panel above the Claude Code prompt, with Clawd, the Claude Code mascot, standing beside it, and a Spotify card under it with Beatbot, a Spotify mascot.

- **Top edge:** the repo name, branch, and the model with its effort and your Claude plan (Max 5x, Pro...). On the right: the session's cost and tokens, then today's and the last 30 days'.
- **Middle:** the 5-hour and 7-day rate limits as filling rings, with the reset countdown and the local reset time. `▲ out ~7h` appears when the pace would use a limit up before it resets. Then context usage as a bar.
- **Bottom edge:** running subagents, uncommitted files and lines, unpushed commits and their lines, commits behind, stashes and the time since the last commit. On the right: the last reply's input (with its cached share) and output tokens, the session length and the time.
- **Clawd:** runs while Claude works. Otherwise it sweats while a rate limit is at 95% or more, falls asleep after 10 quiet minutes, and cheers when your commits are pushed.
- **Actions:** a row under the card sends a prompt as if you typed it: `push` (commit and push), `find bugs`, `run tests` and `summarize`. `quick commit` has Haiku write a message from the diff and shows it: commit, commit and push, or type your own; it then commits itself, without a turn of the main model. Click one, or focus the band with ctrl+x tab, move to it and press Enter.
- **Git switches:** `commit auto · push ask`, kept per repo. On `ask`, Claude's `git add` or `commit`, or `push`, waits for your OK. On `auto` Claude also does it on its own: it commits each finished change, and pushes right after. It runs without a prompt, but only in its plain form, naming its repo with `-C`: `git -C '/abs/path' add <files>`, `git -C '/abs/path' commit -m '…'` and `git -C '/abs/path' push [remote] [branch]`, joined by `&&`. Any other shape asks whatever the switch says: a step without `-C` (the Bash tool keeps its own folder between calls), a force push, a heredoc, `$(…)`, a `cd`, a pipe, a wrapper such as `env` or `xargs`, or an alias that commits or pushes. Nothing is allowed in plan mode. Steps that only read (`status`, `log`, `diff`, `show`, with flags that only shape their output) may ride along. When a step asks, a line under the dialog says what it takes with it. The system prompt tells Claude the plain form and where each switch stands. Click `commit` or `push` to flip it.
- **Spotify (macOS):** off until you click `spotify` beside the git switches (`spotify off`, then `on`, kept across sessions). While it is off, nothing asks Spotify anything. When it is on and Spotify runs, a card framed in Spotify green under the band shows the state and the track, ◀◀ ❚❚ ▶▶, progress with the time, shuffle, repeat and volume − +, and the track heard before it (kept across sessions). `search` (or `/spotify-search`) opens a pane that searches Spotify and plays the track you pick, keeping the terminal in front, once `spotifyClientId` and the client secret are set. Beatbot, a little Spotify mascot drawn in pixels, dances under Clawd while a track plays, and falls asleep with Z's once a track has been paused 10 minutes. It asks Spotify through AppleScript every 5 seconds and never launches it. The playing playlist is not shown: Spotify gives it only through its Web API, which needs a sign-in.
- **Minimize:** `minimize` on the bottom edge of either card shrinks it to one line from the band's left edge. The main card keeps the repo and branch, model, limits and context as percents, the first git fact and the session cost; the Spotify card keeps the controls, the track and the time. `expand` brings it back. Each card remembers its choice across sessions.
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
| `gitStrict` | `true` | On: with a git switch on auto, only plain commands naming their repo with `-C` run without a prompt. Off: any git command runs without a prompt while the repo's switch is on auto |
| `spotify` | `true` | While Spotify runs, show what it plays under the band, with Beatbot dancing, a progress bar and controls (macOS) |
| `plan` | empty | Your Claude plan as shown, such as `Max 20x`; empty reads it from Claude Code's own `~/.claude.json` (updated when Claude Code starts or signs in) |
| `spotifyClientId` | empty | Client ID of your own app at developer.spotify.com/dashboard, for searching Spotify |
| `spotifyClientSecret` | empty | Client secret of that app. `/config` leaves secret settings out, so keep it in the macOS Keychain instead: `security add-generic-password -U -s statusline-band-spotify -a client-secret -w` (it asks for the secret, hidden) |

## What it runs, reads, keeps and sends

### Programs it runs

It runs these programs, never through a shell. The arguments are fixed except the folder (each `git` command runs in the repo's folder, `git -C <folder>`), for quick commit the commit message you approved, and for a searched track its Spotify URI (checked to be `spotify:track:` and letters and digits only).

- **`git`, read-only, to show the branch and its changes** (each in the repo's folder, `git -C <folder>`). It runs:
  - `rev-parse --show-toplevel` for the repo's root, once per folder
  - `status --porcelain=v2 --branch --show-stash` for the branch, its upstream, commits ahead and behind, uncommitted files and stashes
  - `diff --shortstat HEAD` and `diff --shortstat @{upstream}...HEAD` for the lines uncommitted and unpushed
  - `log -1 --format=%ct` for the time of the last commit

  These run every 30 seconds and after each tool call.
- **`git`, when a git step of Claude's asks**, to say under the dialog what it takes with it: the same read-only commands, and `config --get alias.<name>` to see what a git alias in the command stands for.
- **`git`, when you press quick commit:** `status --porcelain`, `diff HEAD` and `log -5 --format=%s` to write the message; then, once you approve it, `add -A`, `commit -q -m <message>` and, if you chose it, `push`. These are the only git commands it runs that change anything.
- **`osascript`, for Spotify:** every 5 seconds, only while the `spotify` switch is on and Spotify runs, to read the track; on a press of a control (play, pause, skip, shuffle, repeat, volume); and when you pick a searched track, to play it and bring the app you were in back to the front.
- **`security find-generic-password -s statusline-band-spotify -w`, for search:** when you open or use the search and the setting is empty, to read the Spotify client secret from your macOS Keychain; once it is found, it is kept until the mod reloads.
- **`date`, to read the local date and time** (`+%Y-%m-%d`, and `+%Y-%m-%d|%I:%M %p|%H|%M|%S`). It also formats a rate limit's reset moment in your timezone (`date -r <epoch>`).

### What it reads

- **From the session:** the usage Claude Code reports (cost, context, rate limits and when they reset), the model's name, the session id and working folder, the subagents that are running, and the token counts at the end of each turn.
- **From Claude Code's own `~/.claude.json`:** only your account's plan type and rate-limit tier, once per load, to show the plan.
- **From Spotify, while it runs:** the playing track's name, artist, album, length, position and id, and the shuffle, repeat and volume settings.
- **From your macOS Keychain:** only the item `statusline-band-spotify`, the Spotify client secret, when you search.
- **What it never reads:** the text of your prompts or Claude's replies. Of tool calls it reads only Bash commands, to find the git steps the switches cover.

### What it keeps

All of it stays in the plugin's own store on your machine, nothing else:

- each repo's git switches, by the repo's root
- the last three Spotify tracks heard
- the `spotify` switch, on or off
- whether each card is minimized
- each day's cost and tokens, for the last 62 days
- each session's last reading, for the last 100 sessions
- rate-limit readings from the last 3 hours, used for the recent pace
- which toasts it has already shown

### What it sends

- **Prompts to Claude, only when you press an action.** Each is the fixed text listed under Actions, sent to this session as if you typed it. A push still goes through your own permission rules.
- **The diff to Haiku, only when you press quick commit.** Up to 24k characters of the diff, the names of new files and the last five commit subjects go to Claude's small model through Claude Code's own model call, the same way Claude Code itself talks to the model, to write the message.
- **A push, only when you choose "Commit and push" in quick commit.** It runs `git push` itself, to the branch's upstream, with the git credentials you already have.
- **A Spotify search, only when you search.** With your own app's client ID and secret, the mod asks accounts.spotify.com for an app token and api.spotify.com for up to 10 tracks matching what you typed; picking one plays it in the Spotify app through AppleScript.
- **Nothing else.** It never fetches from git, makes no other network calls, has no telemetry, and sends nothing to any other service. Commits behind are counted against the remote as of your own last fetch or pull.

### Hooks

- **`tool.call`:** only notes the time and refreshes the panel after the call. It lets every call run unchanged and never blocks or rewrites one.
- **`prompt.submit`:** starts Clawd's running animation. The prompt passes through unchanged.
- **`turn.complete`:** stops the animation and adds the turn's token counts to the totals.
- **`session.start`:** starts the panel's timers and registers `/usage-history` and, with `spotify` on, `/spotify-search`.
- **`command.run`:** answers only its own `/usage-history` and `/spotify-search` commands, by opening their panes.
- **`attribution.text`:** with `noAttribution` on, answers an empty commit trailer and PR footer.
- **`prompt.compose`:** adds one section to the system prompt: the git plain form, where each switch stands, and (with `noAttribution`) no credit lines.
- **Action buttons:** pressing one calls `$.prompt.submit` with its fixed prompt; nothing is sent without a press. `quick commit` instead sends the diff (up to 24k characters) and the last five commit subjects to Haiku through Claude Code's own model call, then runs `git add -A`, `git commit -m` and, if you choose it, `git push` itself.
- **`classic.UserPromptSubmit`, `classic.PostToolUse`:** read the permission mode and effort; they change nothing.
- **`classic.PreToolUse` (Bash only):** runs the hooks beneath it first (your own settings hooks among them; their ask or deny stands), then reads the command as it will run for `git add`, `commit` and `push`, and answers ask or allow by the repo's switches. Any other command passes on to your usual permissions untouched.
- **`ui.render`:** draws the panel above the prompt (`AbovePrompt`), and the history and Spotify search panes (`Pane`).
