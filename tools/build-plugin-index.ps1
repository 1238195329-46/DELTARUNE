# build-plugin-index.ps1
# Scans plugins/ and rewrites plugins/index.json.
# Any folder with a manifest.json is added automatically.
# Run locally:  powershell -ExecutionPolicy Bypass -File tools\build-plugin-index.ps1
# The GitHub Action also runs this on every push.

$pluginsDir = Join-Path $PSScriptRoot '..'
$pluginsDir = Join-Path $pluginsDir 'plugins'
$pluginsDir = (Resolve-Path $pluginsDir).Path

$folders = @(Get-ChildItem -Path $pluginsDir -Directory |
    Where-Object { Test-Path (Join-Path $_.FullName 'manifest.json') } |
    Sort-Object Name |
    ForEach-Object { $_.Name })

$lines = @($folders | ForEach-Object { '    "' + $_ + '"' })
if ($lines.Count -eq 0) {
    $json = "{`n  `"plugins`": []`n}`n"
} else {
    $json = "{`n  `"plugins`": [`n" + ($lines -join ",`n") + "`n  ]`n}`n"
}

# WriteAllText saves UTF-8 without a BOM, which is safest for JSON.
[System.IO.File]::WriteAllText((Join-Path $pluginsDir 'index.json'), $json)
Write-Host "plugins/index.json updated with $($folders.Count) plugin(s): $($folders -join ', ')"
