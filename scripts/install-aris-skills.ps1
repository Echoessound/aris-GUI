param(
  [ValidateSet("User", "Project", "Both")]
  [string]$Scope = "User",
  [string]$TargetProject = "",
  [string]$ArisRepoPath = "",
  [string]$ArisRepoUrl = "https://github.com/wanshuiyin/Auto-claude-code-research-in-sleep.git",
  [switch]$InstallAllSkills,
  [switch]$SkipClaudeSkills
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

function Resolve-FullPath {
  param([string]$PathValue)
  $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($PathValue)
}

function Sync-ArisRepository {
  param([string]$RepoPath, [string]$RepoUrl)

  Require-Command "git" "Install Git for Windows, then reopen PowerShell."
  if (Test-Path (Join-Path $RepoPath ".git")) {
    Write-Step "Updating ARIS skill repository"
    & git -C $RepoPath pull --ff-only
    return
  }

  if (Test-Path $RepoPath) {
    throw "ARIS repo path already exists but is not a Git repository: $RepoPath"
  }

  Write-Step "Cloning ARIS skill repository"
  $parent = Split-Path -Parent $RepoPath
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  & git clone $RepoUrl $RepoPath
}

function Get-CodexSkillSource {
  param([string]$RepoPath)

  $codexRoot = Join-Path $RepoPath "skills\skills-codex"
  if (Test-Path $codexRoot) {
    return $codexRoot
  }
  return (Join-Path $RepoPath "skills")
}

function Copy-SkillDirectory {
  param(
    [string]$SourceRoot,
    [string]$DestinationRoot,
    [string[]]$SkillNames
  )

  if (-not (Test-Path $SourceRoot)) {
    throw "Skill source does not exist: $SourceRoot"
  }

  New-Item -ItemType Directory -Force -Path $DestinationRoot | Out-Null
  if ($SkillNames.Count -gt 0) {
    $children = foreach ($skillName in $SkillNames) {
      $source = Join-Path $SourceRoot $skillName
      if (Test-Path $source) {
        Get-Item -LiteralPath $source
      } else {
        Write-Warning "Skill not found in source and will be skipped: $skillName"
      }
    }
  } else {
    $children = Get-ChildItem -LiteralPath $SourceRoot -Directory
  }
  $installed = @()

  foreach ($child in $children) {
    $target = Join-Path $DestinationRoot $child.Name
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Copy-Item -LiteralPath (Join-Path $child.FullName "*") -Destination $target -Recurse -Force
    $installed += $child.Name
  }

  return $installed
}

function Write-InstallManifest {
  param(
    [string]$Root,
    [string]$RepoPath,
    [string[]]$InstalledSkills
  )

  $arisDir = Join-Path $Root ".aris"
  New-Item -ItemType Directory -Force -Path $arisDir | Out-Null
  Set-Content -Encoding UTF8 -Path (Join-Path $arisDir "skill-source.txt") -Value $RepoPath
  Set-Content -Encoding UTF8 -Path (Join-Path $arisDir "installed-skills.txt") -Value ($InstalledSkills | Sort-Object)
}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $TargetProject) {
  $TargetProject = $ProjectRoot
}
$TargetProject = Resolve-FullPath $TargetProject

if (-not $ArisRepoPath) {
  $ArisRepoPath = Join-Path $HOME ".aris\Auto-claude-code-research-in-sleep"
}
$ArisRepoPath = Resolve-FullPath $ArisRepoPath

Sync-ArisRepository -RepoPath $ArisRepoPath -RepoUrl $ArisRepoUrl

$codexSource = Get-CodexSkillSource -RepoPath $ArisRepoPath
$claudeSource = Join-Path $ArisRepoPath "skills"
$coreSkills = @(
  "idea-discovery",
  "research-refine",
  "experiment-plan",
  "experiment-bridge",
  "auto-review-loop",
  "paper-writing",
  "research-pipeline",
  "research-wiki",
  "result-to-claim",
  "paper-compile"
)
$selectedSkills = if ($InstallAllSkills) { @() } else { $coreSkills }

if ($Scope -eq "User" -or $Scope -eq "Both") {
  Write-Step "Installing ARIS skills for current user"
  $codexUserRoot = Join-Path $HOME ".codex\skills"
  $codexInstalled = Copy-SkillDirectory -SourceRoot $codexSource -DestinationRoot $codexUserRoot -SkillNames $selectedSkills
  Write-Host "Codex skills: $codexUserRoot"

  if (-not $SkipClaudeSkills) {
    $claudeUserRoot = Join-Path $HOME ".claude\skills"
    Copy-SkillDirectory -SourceRoot $claudeSource -DestinationRoot $claudeUserRoot -SkillNames $selectedSkills | Out-Null
    Write-Host "Claude skills: $claudeUserRoot"
  }

  Write-InstallManifest -Root $HOME -RepoPath $ArisRepoPath -InstalledSkills $codexInstalled
}

if ($Scope -eq "Project" -or $Scope -eq "Both") {
  Write-Step "Installing ARIS skills into project"
  $codexProjectRoot = Join-Path $TargetProject ".agents\skills"
  $codexInstalled = Copy-SkillDirectory -SourceRoot $codexSource -DestinationRoot $codexProjectRoot -SkillNames $selectedSkills
  Write-Host "Project Codex skills: $codexProjectRoot"

  if (-not $SkipClaudeSkills) {
    $claudeProjectRoot = Join-Path $TargetProject ".claude\skills"
    Copy-SkillDirectory -SourceRoot $claudeSource -DestinationRoot $claudeProjectRoot -SkillNames $selectedSkills | Out-Null
    Write-Host "Project Claude skills: $claudeProjectRoot"
  }

  Write-InstallManifest -Root $TargetProject -RepoPath $ArisRepoPath -InstalledSkills $codexInstalled
}

Write-Step "ARIS skill installation complete"
Write-Host "Source: $ArisRepoPath"
