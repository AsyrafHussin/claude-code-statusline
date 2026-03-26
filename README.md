# Claude Code Status Line

A clean, informative status line for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) built with pure Bash. No dependencies beyond `jq` and `git`.

## Preview

```
agent-skills | main synced | Opus 4.6 (1M context) | 20m22s | Thu 26 Mar 08:37 AM
ctx 5% (128k/1.0m) | session 9% resets 3h24m | weekly 7%
```

## What It Shows

### Line 1 - Project Info

| Segment | Description |
|---------|-------------|
| **Project** | Current folder name (bold yellow) |
| **Branch** | Git branch with status (magenta) |
| **Git Status** | `synced` / `uncommitted` / `3 unpushed` / `2 behind` |
| **Model** | Current Claude model (cyan) |
| **Duration** | Session duration (e.g., `20m22s`) |
| **Date/Time** | Current date and time with AM/PM |

### Line 2 - Usage Metrics

| Segment | Description |
|---------|-------------|
| **ctx** | Context window usage with token count (e.g., `5% (128k/1.0m)`) |
| **session** | 5-hour session rate limit with reset countdown |
| **weekly** | 7-day all-models rate limit |

All percentages are color-coded: **green** (< 50%), **yellow** (50-79%), **red** (80%+).

## Requirements

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [jq](https://jqlang.github.io/jq/) - JSON processor
- `git` - for branch/status info

## Installation

### Quick Install

```bash
git clone https://github.com/AsyrafHussin/claude-code-statusline.git
cd claude-code-statusline
./install.sh
```

### Manual Install

1. Copy the script:

```bash
cp statusline.sh ~/.claude/statusline-command.sh
chmod +x ~/.claude/statusline-command.sh
```

2. Add to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash ~/.claude/statusline-command.sh"
  }
}
```

3. Restart Claude Code.

## Git Status Indicators

| Status | Color | Meaning |
|--------|-------|---------|
| `synced` | Green | Clean and up to date with remote |
| `uncommitted` | Red | Uncommitted local changes |
| `3 unpushed` | Yellow | 3 commits not pushed to remote |
| `2 behind` | Red | Remote has 2 commits you haven't pulled |
| `unpushed` | Yellow | No remote tracking branch |

## Customization

Edit `~/.claude/statusline-command.sh` to customize colors, segments, or layout. The script receives a JSON payload from Claude Code via stdin with fields like:

- `model.display_name` - Current model
- `context_window.used_percentage` - Context usage
- `rate_limits.five_hour.used_percentage` - Session rate limit
- `rate_limits.seven_day.used_percentage` - Weekly rate limit
- `cost.total_duration_ms` - Session duration

See the [Claude Code statusline docs](https://docs.anthropic.com/en/docs/claude-code/statusline) for all available fields.

## License

MIT
