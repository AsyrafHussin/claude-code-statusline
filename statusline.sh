#!/usr/bin/env bash
# Claude Code status line

input=$(cat)

# --- Parse JSON ---
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty')
model=$(echo "$input" | jq -r '.model.display_name // empty')
ctx_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
ctx_tokens=$(echo "$input" | jq -r '.context_window.total_input_tokens // empty')
ctx_size=$(echo "$input" | jq -r '.context_window.context_window_size // empty')
duration_ms=$(echo "$input" | jq -r '.cost.total_duration_ms // empty')
five_h=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
five_h_reset=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
seven_d=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')

# --- Folder name only ---
folder="${cwd##*/}"

# --- Colors (ys theme style) ---
RST="\033[0m"
DIM="\033[2m"
BOLD="\033[1m"
CYAN="\033[0;36m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
BLUE="\033[0;34m"
MAGENTA="\033[0;35m"
RED="\033[0;31m"
WHITE="\033[1;37m"

pct_color() {
  local pct=$1
  if [ "$pct" -ge 80 ]; then printf "$RED"
  elif [ "$pct" -ge 50 ]; then printf "$YELLOW"
  else printf "$GREEN"; fi
}

format_tokens() {
  local num=$1
  if [ -z "$num" ] || [ "$num" = "null" ]; then printf "?"; return; fi
  if [ "$num" -ge 1000000 ]; then
    awk "BEGIN {printf \"%.1fm\", $num / 1000000}"
  elif [ "$num" -ge 1000 ]; then
    awk "BEGIN {printf \"%.0fk\", $num / 1000}"
  else
    printf "%d" "$num"
  fi
}

format_duration() {
  local ms=$1
  if [ -z "$ms" ] || [ "$ms" = "null" ]; then printf "0s"; return; fi
  local secs=$(( ms / 1000 ))
  if [ "$secs" -ge 3600 ]; then
    printf "%dh%dm" $((secs/3600)) $(( (secs%3600)/60 ))
  elif [ "$secs" -ge 60 ]; then
    printf "%dm%ds" $((secs/60)) $((secs%60))
  else
    printf "%ds" "$secs"
  fi
}

sep="${DIM} | ${RST}"

# ── LINE 1: Project + Git + Model + Session ──

line1="${YELLOW}${BOLD}${folder}${RST}"

# Git
if git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1; then
  branch=$(git -C "$cwd" symbolic-ref --short HEAD 2>/dev/null || git -C "$cwd" rev-parse --short HEAD 2>/dev/null)
  # Check ahead/behind remote
  ahead=$(git -C "$cwd" rev-list --count "@{upstream}..HEAD" 2>/dev/null || echo "0")
  behind=$(git -C "$cwd" rev-list --count "HEAD..@{upstream}" 2>/dev/null || echo "0")
  has_remote=$(git -C "$cwd" rev-parse --verify "@{upstream}" 2>/dev/null)

  # Check uncommitted changes
  porcelain=$(git -C "$cwd" status --porcelain 2>/dev/null)
  dirty=""
  if [ -n "$porcelain" ]; then
    dirty=" ${RED}uncommitted${RST}"
  fi

  # Check push status
  push_status=""
  if [ -z "$has_remote" ]; then
    push_status=" ${YELLOW}unpushed${RST}"
  elif [ "$ahead" -gt 0 ] && [ "$behind" -gt 0 ]; then
    push_status=" ${YELLOW}+${ahead}/-${behind}${RST}"
  elif [ "$ahead" -gt 0 ]; then
    push_status=" ${YELLOW}${ahead} unpushed${RST}"
  elif [ "$behind" -gt 0 ]; then
    push_status=" ${RED}${behind} behind${RST}"
  elif [ -z "$dirty" ]; then
    push_status=" ${GREEN}synced${RST}"
  fi
  line1+="${sep}${MAGENTA}${branch}${RST}${dirty}${push_status}"
fi

# Model
if [ -n "$model" ]; then
  line1+="${sep}${CYAN}${model}${RST}"
fi

# Session duration
if [ -n "$duration_ms" ] && [ "$duration_ms" != "null" ] && [ "$duration_ms" -gt 0 ]; then
  dur=$(format_duration "$duration_ms")
  line1+="${sep}${WHITE}${dur}${RST}"
fi

# Date + Time
line1+="${sep}${DIM}$(date '+%a %d %b %I:%M %p')${RST}"

printf "%b\n" "$line1"

# ── LINE 2: Context + Rate Limits ──

line2=""

# Context window
if [ -n "$ctx_pct" ] && [ "$ctx_pct" != "null" ]; then
  printf -v ctx_int "%.0f" "$ctx_pct"
  tok_used=$(format_tokens "$ctx_tokens")
  tok_total=$(format_tokens "$ctx_size")
  ctx_c=$(pct_color "$ctx_int")
  line2+="${DIM}ctx${RST} ${ctx_c}${ctx_int}%${RST} ${DIM}(${tok_used}/${tok_total})${RST}"
fi

# 5h rate limit
if [ -n "$five_h" ] && [ "$five_h" != "null" ]; then
  printf -v five_int "%.0f" "$five_h"
  five_c=$(pct_color "$five_int")
  reset_hint=""
  if [ -n "$five_h_reset" ] && [ "$five_h_reset" != "null" ]; then
    now=$(date +%s)
    diff=$(( five_h_reset - now ))
    if [ "$diff" -gt 0 ]; then
      reset_h=$(( diff / 3600 ))
      reset_m=$(( (diff % 3600) / 60 ))
      if [ "$reset_h" -gt 0 ]; then
        reset_hint=" ${DIM}resets ${reset_h}h${reset_m}m${RST}"
      else
        reset_hint=" ${DIM}resets ${reset_m}m${RST}"
      fi
    fi
  fi
  line2+="${sep}${DIM}session${RST} ${five_c}${five_int}%${RST}${reset_hint}"
fi

# Weekly all models limit
if [ -n "$seven_d" ] && [ "$seven_d" != "null" ]; then
  printf -v seven_int "%.0f" "$seven_d"
  seven_c=$(pct_color "$seven_int")
  line2+="${sep}${DIM}weekly${RST} ${seven_c}${seven_int}%${RST}"
fi

if [ -n "$line2" ]; then
  printf "%b\n" "$line2"
fi
