param(
  [switch]$SkipBuild,
  [switch]$SkipElectronRebuild,
  [switch]$SkipArisSkills,
  [ValidateSet("User", "Project", "Both")]
  [string]$ArisSkillScope = "User"
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Require-Command {
  param([string]$Name, [string]$InstallHint)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is not available. $InstallHint"
  }
}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

Write-Step "Checking local toolchain"
Require-Command "node" "Install Node.js 20 LTS or newer, then reopen PowerShell."

$nodeVersionText = (& node -p "process.versions.node").Trim()
$nodeMajor = [int]($nodeVersionText.Split(".")[0])
if ($nodeMajor -lt 20) {
  throw "Node.js $nodeVersionText detected. ARIS Paper Studio requires Node.js 20 or newer."
}
Write-Host "Node.js $nodeVersionText"

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Host "pnpm was not found. Trying to enable it through Corepack..."
  Require-Command "corepack" "Install pnpm manually with: npm install -g pnpm"
  & corepack enable
  & corepack prepare pnpm@latest --activate
}
Require-Command "pnpm" "Install pnpm manually with: npm install -g pnpm"
Write-Host "pnpm $((& pnpm --version).Trim())"

Write-Step "Installing dependencies"
& pnpm install

if (-not $SkipArisSkills) {
  & (Join-Path $PSScriptRoot "install-aris-skills.ps1") -Scope $ArisSkillScope
}

if (-not $SkipElectronRebuild) {
  Write-Step "Rebuilding native Electron modules"
  & pnpm rebuild:electron
}

if (-not $SkipBuild) {
  Write-Step "Verifying TypeScript and production build"
  & pnpm build
}

Write-Step "Install complete"
Write-Host "Development: pnpm dev"
Write-Host "Production build: pnpm dist"
