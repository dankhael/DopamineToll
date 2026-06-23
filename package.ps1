# Build a Chrome Web Store-ready ZIP containing only the files Chrome actually loads.
# Dev-only files (this script, gen-icons.ps1, README.md, CLAUDE.md, PRIVACY.md, .git,
# .gitignore) are intentionally left out of the package.
#
# Usage:  ./package.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# The loadable extension = manifest at the ZIP root + these asset folders. Anything
# not listed here is deliberately excluded from what ships to users.
$include = @("manifest.json", "assets", "background", "content", "options", "popup")

# Expand the includes into a flat file list, verifying each top-level entry exists so a
# future rename can't silently ship an incomplete package.
$files = New-Object System.Collections.Generic.List[System.IO.FileInfo]
foreach ($item in $include) {
  $p = Join-Path $root $item
  if (-not (Test-Path $p)) { throw "package.ps1: required path missing: '$item' (expected at '$p')" }
  if (Test-Path $p -PathType Container) {
    Get-ChildItem -Path $p -Recurse -File | ForEach-Object { $files.Add($_) }
  } else {
    $files.Add((Get-Item $p))
  }
}

# The artifact name carries the manifest version, read straight from the source of truth.
$manifest = Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json
$version = $manifest.version
if (-not $version) { throw "package.ps1: manifest.json is missing a 'version' field" }

$outDir = Join-Path $root "web-ext-artifacts"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
$zip = Join-Path $outDir "dopamine-toll-$version.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }

# Build the archive by hand so entry paths use forward slashes — the ZIP spec (and the
# Chrome Web Store) expects "/", but Windows PowerShell's Compress-Archive writes "\",
# which unpacks as literal "assets\icon.png" filenames on macOS/Linux.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$rootPrefix = $root.TrimEnd('\') + '\'
$stream = [System.IO.File]::Open($zip, [System.IO.FileMode]::Create)
$archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($f in $files) {
    $entryName = $f.FullName.Substring($rootPrefix.Length).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $f.FullName, $entryName) | Out-Null
  }
} finally {
  $archive.Dispose()
  $stream.Dispose()
}

Write-Output "packaged -> $zip"
Write-Output ("files:     " + $files.Count + " (" + ($include -join ", ") + ")")
