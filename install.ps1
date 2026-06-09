# Claude Code Status Line - Windows installer (PowerShell)
# Equivalent of install.sh for Windows. Run from the repo folder:  ./install.ps1
$ErrorActionPreference = 'Stop'

function Have($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

Write-Host "Claude Code Status Line - Windows installer" -ForegroundColor Cyan

# 1) Dependency checks ---------------------------------------------------------
if (-not (Have git)) { Write-Error "git not found. Install: winget install Git.Git"; exit 1 }
if (-not (Have jq))  { Write-Error "jq not found. Install: winget install jqlang.jq"; exit 1 }

# Git Bash is required to RUN the status line (Claude executes it via sh).
$bash = Get-Command bash -ErrorAction SilentlyContinue
if (-not $bash) {
    $candidate = "C:\Program Files\Git\bin\bash.exe"
    if (Test-Path $candidate) {
        Write-Warning "bash is not on PATH. Add Git Bash so the status line can run:"
        Write-Host '  [Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path","User") + ";C:\Program Files\Git\bin", "User")' -ForegroundColor Yellow
        Write-Host "  (then open a new terminal)" -ForegroundColor Yellow
    } else {
        Write-Error "bash (Git Bash) not found. Install Git for Windows: winget install Git.Git"; exit 1
    }
}

# 2) Paths --------------------------------------------------------------------
$claudeDir = Join-Path $HOME ".claude"
$dest      = Join-Path $claudeDir "statusline-command.sh"
$settings  = Join-Path $claudeDir "settings.json"
$src       = Join-Path $PSScriptRoot "statusline.sh"

New-Item -ItemType Directory -Force -Path $claudeDir | Out-Null

# 3) Backup existing script ---------------------------------------------------
if (Test-Path $dest) {
    Copy-Item $dest "$dest.bak" -Force
    Write-Host "Backed up existing script -> statusline-command.sh.bak"
}

# 4) Copy script --------------------------------------------------------------
Copy-Item $src $dest -Force
Write-Host "Installed script -> $dest"

# 5) Build the command (Unix-style path; backslashes break under sh) ----------
# Convert C:\Users\you\.claude\... -> /c/Users/you/.claude/...
$drive = $dest.Substring(0,1).ToLower()
$rest  = $dest.Substring(2) -replace '\\','/'
$unix  = "/$drive$rest"
$command = "bash $unix"

# 6) Merge into settings.json -------------------------------------------------
if (Test-Path $settings) {
    $json = Get-Content $settings -Raw | ConvertFrom-Json
} else {
    $json = [PSCustomObject]@{}
}
$statusLine = [PSCustomObject]@{ type = "command"; command = $command }
if ($json.PSObject.Properties.Name -contains 'statusLine') {
    $json.statusLine = $statusLine
} else {
    $json | Add-Member -NotePropertyName statusLine -NotePropertyValue $statusLine
}
$json | ConvertTo-Json -Depth 20 | Set-Content -Path $settings -Encoding utf8
Write-Host "Updated settings.json -> statusLine: $command"

Write-Host "`nDone. Restart Claude Code to see the status line." -ForegroundColor Green
