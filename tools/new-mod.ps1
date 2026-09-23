# new-mod.ps1
# Creates a new mod folder with a starter manifest and main.js,
# then refreshes plugins/index.json.
# Usage:  powershell -ExecutionPolicy Bypass -File tools\new-mod.ps1 -Name my-mod

param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z0-9-]+$')]
    [string]$Name
)

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$modDir = Join-Path (Join-Path $root 'plugins') $Name

if (Test-Path $modDir) {
    Write-Host "A mod named '$Name' already exists." -ForegroundColor Red
    exit 1
}

New-Item -ItemType Directory -Path (Join-Path $modDir 'assets') -Force | Out-Null

$manifest = @"
{
  "id": "$Name",
  "name": "$Name",
  "version": "1.0.0",
  "description": "Describe what this mod does.",
  "main": "main.js",
  "priority": 0,
  "dependencies": [],
  "overrides": {}
}
"@

$main = @"
// $Name - starter mod.

export function activate(ctx) {
  ctx.log('activated');

  // Example: edit battle data before the battle starts.
  ctx.on('onBattleStart', (data) => {
    return data; // return a modified copy to change it
  });
}

export function deactivate(ctx) {
  ctx.log('deactivated');
}
"@

[System.IO.File]::WriteAllText((Join-Path $modDir 'manifest.json'), $manifest)
[System.IO.File]::WriteAllText((Join-Path $modDir 'main.js'), $main)

& (Join-Path $PSScriptRoot 'build-plugin-index.ps1')
Write-Host "Created plugins/$Name" -ForegroundColor Green
