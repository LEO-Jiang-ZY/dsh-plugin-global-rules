# Download and install this plugin from GitHub, without Git and without cloning.
#
# Usage (run in PowerShell):
#
#   .\install.ps1                          # uses the repository configured below
#   .\install.ps1 -Repo owner/name         # a different repository
#   .\install.ps1 -From dist\xxx.zip       # an archive already downloaded
#   .\install.ps1 -Force                   # replace an existing installation
#
# The script does three things: download, extract into ~/.dsh/plugins, and print the
# path to paste into DSH. It never edits a DSH configuration file - installing stays
# a decision you confirm in the DSH interface.
#
# This file is deliberately ASCII-only. Windows PowerShell 5.1 reads a .ps1 without a
# byte-order mark as ANSI, so non-ASCII text here becomes mojibake and breaks parsing.
# The Chinese documentation lives in README.md instead.
[CmdletBinding()]
param(
    # GitHub repository in owner/name form.
    [string]$Repo = 'LEO-Jiang-ZY/dsh-plugin-global-rules',

    # Release tag to fetch. The default takes the latest published release.
    [string]$Tag = 'latest',

    # Use a local archive instead of downloading.
    [string]$From,

    # Where to extract. The default is ~/.dsh/plugins.
    [string]$Destination = (Join-Path $HOME '.dsh\plugins'),

    # Replace an existing installation.
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Write-Step($Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok($Message) { Write-Host "    $Message" -ForegroundColor Green }

Write-Step "Preparing $Destination"
New-Item -ItemType Directory -Path $Destination -Force | Out-Null

$archive = $null
$temporary = $null

if ($From) {
    if (-not (Test-Path $From)) { throw "Archive not found: $From" }
    $archive = (Resolve-Path $From).Path
    Write-Ok "Using the local archive $archive"
}
else {
    $api = if ($Tag -eq 'latest') {
        "https://api.github.com/repos/$Repo/releases/latest"
    } else {
        "https://api.github.com/repos/$Repo/releases/tags/$Tag"
    }
    $name = 'dsh-plugin-global-rules.zip'
    $url = $null

    Write-Step "Reading release information from $api"
    try {
        $info = Invoke-RestMethod -Uri $api -Headers @{ 'User-Agent' = 'dsh-plugin-installer' } -TimeoutSec 30
        $asset = $info.assets | Where-Object { $_.name -like '*.zip' } | Select-Object -First 1
        if (-not $asset) { throw 'That release has no .zip asset' }
        $name = $asset.name
        $url = $asset.browser_download_url
    }
    catch {
        # No release published yet: fall back to the source archive, which installs the
        # same way.
        Write-Warning "Could not read the release information ($($_.Exception.Message)); using the source archive instead"
        $branch = 'main'
        $url = "https://github.com/$Repo/archive/refs/heads/$branch.zip"
        $name = "$($Repo.Split('/')[-1])-$branch.zip"
    }

    $temporary = Join-Path ([System.IO.Path]::GetTempPath()) $name
    Write-Step "Downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $temporary -TimeoutSec 300
    $archive = $temporary
    Write-Ok ('Downloaded {0:N0} KB' -f ((Get-Item $archive).Length / 1KB))
}

$staging = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-plugin-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $staging -Force | Out-Null

Write-Step 'Extracting'
Expand-Archive -Path $archive -DestinationPath $staging -Force

# A release archive holds exactly one top-level directory. A source archive appends the
# branch name to it, which does not matter here.
$roots = @(Get-ChildItem $staging -Directory)
if ($roots.Count -ne 1) {
    throw "Expected exactly one top-level directory in the archive, found $($roots.Count)"
}
$source = $roots[0].FullName

if (-not (Test-Path (Join-Path $source 'package.json'))) {
    throw "No package.json after extracting, so this archive is not the plugin: $source"
}

$target = Join-Path $Destination 'dsh-plugin-global-rules'
if (Test-Path $target) {
    if (-not $Force) {
        $existing = Get-Content (Join-Path $target 'package.json') -Raw | ConvertFrom-Json
        throw "Already present: $target (version $($existing.version)). Pass -Force to replace it, or uninstall first."
    }
    Write-Step "Removing the existing $target"
    Remove-Item $target -Recurse -Force
}

Write-Step "Installing into $target"
Move-Item -Path $source -Destination $target

$manifest = Get-Content (Join-Path $target 'package.json') -Raw | ConvertFrom-Json
Write-Ok "$($manifest.name) v$($manifest.version)"

Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
if ($temporary) { Remove-Item $temporary -Force -ErrorAction SilentlyContinue }

Write-Host ''
Write-Host 'Files are in place. Finish the install inside DeepSeek Harness:' -ForegroundColor Yellow
Write-Host ''
Write-Host '  1. Open DeepSeek Harness and choose Plugins in the left sidebar.'
Write-Host '  2. Click Add plugin.'
Write-Host '  3. Paste this path into the field, click Install, then click Enable now:'
Write-Host ''
Write-Host "     $target" -ForegroundColor Green
Write-Host ''
Write-Host '  4. Restart DeepSeek Harness once.'
Write-Host ''
Write-Host 'After the restart, a "Rule manager" entry appears at the bottom of the sidebar.' -ForegroundColor Yellow
