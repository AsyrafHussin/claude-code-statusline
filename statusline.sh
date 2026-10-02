#!/usr/bin/env bash
# Claude Code status line: two lines read from the JSON Claude Code sends on stdin. Text that comes from
# outside (folder, branch, model) is printed with %s, never %b, so a backslash in it is shown as is.

input=$(cat)

# --- Parse JSON, in one jq run ---
# Fields are joined by the unit separator (\x1f), not a tab, so an empty field keeps its place when read
SEP=$'\x1f'
IFS="$SEP" read -r cwd model ctx_pct ctx_size ctx_tokens duration_ms five_h five_h_reset seven_d seven_d_reset < <(
  printf '%s' "$input" | jq -r '[
    (.workspace.current_dir // .cwd // ""),
    (.model.display_name // ""),
    (.context_window.used_percentage // ""),
    (.context_window.context_window_size // ""),
    # current_usage (the context as it stands), not cumulative totals, to match used_percentage
    (.context_window.current_usage // null
      | if . then (.input_tokens // 0) + (.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0) else "" end),
    (.cost.total_duration_ms // 0 | floor),
    (.rate_limits.five_hour.used_percentage // ""),
    (.rate_limits.five_hour.resets_at // ""),
    (.rate_limits.seven_day.used_percentage // ""),
    (.rate_limits.seven_day.resets_at // "")
  ] | map(tostring) | join("\u001f")'
)

folder="${cwd##*/}"
now=$(date +%s)

# --- Colors (ys theme style), as the escape characters themselves ---
RST=$'\033[0m'
DIM=$'\033[2m'
BOLD=$'\033[1m'
CYAN=$'\033[0;36m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
MAGENTA=$'\033[0;35m'
RED=$'\033[0;31m'
WHITE=$'\033[1;37m'

pct_color() {
  if [ "$1" -ge 80 ]; then printf '%s' "$RED"
  elif [ "$1" -ge 50 ]; then printf '%s' "$YELLOW"
  else printf '%s' "$GREEN"; fi
}

format_tokens() {
  local num=$1
  case "$num" in '' | *[!0-9]*) printf '?'; return ;; esac
  if [ "$num" -ge 999950000 ]; then
    awk -v n="$num" 'BEGIN {printf "%.1fb", n / 1000000000}'
  elif [ "$num" -ge 999500 ]; then
    awk -v n="$num" 'BEGIN {printf "%.1fm", n / 1000000}'
  elif [ "$num" -ge 1000 ]; then
    awk -v n="$num" 'BEGIN {printf "%.0fk", n / 1000}'
  else
    printf '%d' "$num"
  fi
}

format_duration() {
  local ms=$1
  case "$ms" in '' | *[!0-9]* | 0) printf '0s'; return ;; esac
  local secs=$(( ms / 1000 ))
  if [ "$secs" -ge 3600 ]; then
    printf '%dh%dm' $((secs / 3600)) $(( (secs % 3600) / 60 ))
  elif [ "$secs" -ge 60 ]; then
    printf '%dm%ds' $((secs / 60)) $((secs % 60))
  else
    printf '%ds' "$secs"
  fi
}

# Seconds as "1d9h", "2h3m" or "5m"
format_span() {
  local secs=$1
  if [ "$secs" -ge 86400 ]; then
    printf '%dd%dh' $((secs / 86400)) $(( (secs % 86400) / 3600 ))
  elif [ "$secs" -ge 3600 ]; then
    printf '%dh%dm' $((secs / 3600)) $(( (secs % 3600) / 60 ))
  else
    printf '%dm' $((secs / 60))
  fi
}

# An epoch in local time: "11:10 AM" within a day, else "Sat 8:00 PM" (BSD date, then GNU)
local_time() {
  local epoch=$1 fmt="+%-I:%M %p"
  [ $(( epoch - now )) -ge 86400 ] && fmt="+%a %-I:%M %p"
  date -r "$epoch" "$fmt" 2>/dev/null || date -d "@$epoch" "$fmt" 2>/dev/null
}

# Lines added and removed from `git diff --shortstat`, as " +12 -4"
shortstat_lines() {
  local stat=$1 out="" added removed
  added=$(printf '%s' "$stat" | sed -nE 's/.* ([0-9]+) insertion.*/\1/p')
  removed=$(printf '%s' "$stat" | sed -nE 's/.* ([0-9]+) deletion.*/\1/p')
  [ -n "$added" ] && out+=" ${GREEN}+${added}${RST}"
  [ -n "$removed" ] && out+=" ${RED}-${removed}${RST}"
  printf '%s' "$out"
}

# A rate limit: "95% resets 1d9h (Sat 8:00 PM)", warning when the pace so far would use it up before
# the reset
limit_hint() {
  local pct=$1 reset=$2 window=$3 diff elapsed left hint=""
  case "$reset" in '' | *[!0-9]*) return ;; esac
  diff=$(( reset - now ))
  [ "$diff" -le 0 ] && return
  hint=" ${DIM}resets $(format_span "$diff") ($(local_time "$reset"))${RST}"
  elapsed=$(( window - diff ))
  # Too early in a window, one burst would read as a runaway pace
  if [ "$pct" -gt 0 ] && [ "$pct" -lt 100 ] && [ "$elapsed" -ge $(( window / 20 )) ]; then
    left=$(( (100 - pct) * elapsed / pct ))
    [ "$left" -lt "$diff" ] && hint+=" ${RED}${BOLD}! out ~$(format_span "$left")${RST}"
  fi
  printf '%s' "$hint"
}

sep="${DIM} | ${RST}"

# ── LINE 1: Project + Git + Model + Session ──

line1=""
[ -n "$folder" ] && line1="${YELLOW}${BOLD}${folder}${RST}"
# Appends a part, with the separator before it when the line already holds something
add1() { if [ -n "$line1" ]; then line1+="${sep}$1"; else line1="$1"; fi; }

# Git: one status read gives the branch, its upstream, ahead and behind, stashes and changed paths.
# Skipped when Claude Code sent no folder, so git does not read the script's own
if [ -n "$cwd" ] && status=$(git -C "$cwd" status --porcelain=v2 --branch --show-stash 2>/dev/null); then
  oid="" branch="" upstream="" ahead=0 behind=0 stashes=0 files=0
  while IFS= read -r row; do
    case "$row" in
      '# branch.oid '*) oid=${row#\# branch.oid } ;;
      '# branch.head '*) branch=${row#\# branch.head } ;;
      '# branch.upstream '*) upstream=${row#\# branch.upstream } ;;
      '# branch.ab '*)
        ab=${row#\# branch.ab }
        ahead=${ab%% *}; ahead=${ahead#+}
        behind=${ab##* }; behind=${behind#-} ;;
      '# stash '*) stashes=${row#\# stash } ;;
      '#'* | '! '* | '') ;;
      *) files=$((files + 1)) ;;
    esac
  done <<< "$status"
  # A detached head shows its short commit
  [ "$branch" = "(detached)" ] && branch=${oid:0:7}

  # Uncommitted files and their lines
  dirty=""
  if [ "$files" -gt 0 ]; then
    [ "$files" -eq 1 ] && noun="file" || noun="files"
    dirty=" ${YELLOW}${files} ${noun}${RST}$(shortstat_lines "$(git -C "$cwd" diff --shortstat HEAD 2>/dev/null)")"
  fi

  # Commits to push (with their lines) and to pull
  push_status=""
  if [ -z "$upstream" ]; then
    push_status=" ${YELLOW}no upstream${RST}"
  else
    if [ "$ahead" -gt 0 ]; then
      [ "$ahead" -eq 1 ] && noun="commit" || noun="commits"
      push_status+=" ${YELLOW}↑${ahead} ${noun}${RST}$(shortstat_lines "$(git -C "$cwd" diff --shortstat "@{upstream}...HEAD" 2>/dev/null)")"
    fi
    [ "$behind" -gt 0 ] && push_status+=" ${RED}↓${behind} behind${RST}"
    if [ -z "$dirty" ] && [ "$ahead" -eq 0 ] && [ "$behind" -eq 0 ]; then
      push_status=" ${GREEN}synced${RST}"
    fi
  fi

  [ "$stashes" -gt 0 ] && push_status+=" ${CYAN}≡${stashes} stash${RST}"

  # How long since the last commit
  last_commit=$(git -C "$cwd" log -1 --format=%ct 2>/dev/null)
  if [ -n "$last_commit" ]; then
    push_status+=" ${DIM}committed $(format_span $(( now - last_commit ))) ago${RST}"
  fi
  add1 "${MAGENTA}${branch}${RST}${dirty}${push_status}"
fi

# Model, and the Claude plan from Claude Code's own config (only the account type and tier are read)
[ -n "$model" ] && add1 "${CYAN}${model}${RST}"
plan=""
if [ -f "$HOME/.claude.json" ]; then
  IFS='|' read -r plan_type plan_tier < <(jq -r '.oauthAccount // {} | "\(.organizationType // "")|\(.organizationRateLimitTier // "")"' "$HOME/.claude.json" 2>/dev/null)
  case "$plan_type" in
    claude_max) times=$(printf '%s' "$plan_tier" | sed -nE 's/.*[^0-9]([0-9]+)x.*/\1/p'); plan="Max${times:+ ${times}x}" ;;
    claude_pro) plan="Pro" ;;
    claude_team) plan="Team" ;;
    claude_enterprise) plan="Enterprise" ;;
  esac
fi
[ -n "$plan" ] && add1 "${YELLOW}${plan}${RST}"

# Session duration
case "$duration_ms" in
  '' | *[!0-9]* | 0) ;;
  *) add1 "${WHITE}$(format_duration "$duration_ms")${RST}" ;;
esac

# Date + Time
add1 "${DIM}$(date '+%a %d %b %I:%M %p')${RST}"

printf '%s\n' "$line1"

# ── LINE 2: Context + Rate Limits ──

line2=""

# Context window
if [ -n "$ctx_pct" ]; then
  printf -v ctx_int '%.0f' "$ctx_pct"
  line2+="${DIM}ctx${RST} $(pct_color "$ctx_int")${ctx_int}%${RST} ${DIM}($(format_tokens "$ctx_tokens")/$(format_tokens "$ctx_size"))${RST}"
fi

# Session rate limit
if [ -n "$five_h" ]; then
  printf -v five_int '%.0f' "$five_h"
  [ -n "$line2" ] && line2+="${sep}"
  line2+="${DIM}session${RST} $(pct_color "$five_int")${five_int}%${RST}$(limit_hint "$five_int" "$five_h_reset" 18000)"
fi

# Weekly all models limit
if [ -n "$seven_d" ]; then
  printf -v seven_int '%.0f' "$seven_d"
  [ -n "$line2" ] && line2+="${sep}"
  line2+="${DIM}weekly${RST} $(pct_color "$seven_int")${seven_int}%${RST}$(limit_hint "$seven_int" "$seven_d_reset" 604800)"
fi

[ -n "$line2" ] && printf '%s\n' "$line2"
exit 0
