[CmdletBinding()]
param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$failures = [System.Collections.Generic.List[string]]::new()
$srcRoot = Join-Path $ProjectRoot 'src'
$indexPath = Join-Path $srcRoot 'index.html'

function Add-Failure([string]$Message) {
  $failures.Add($Message)
  Write-Host "FAIL: $Message" -ForegroundColor Red
}

function Add-Pass([string]$Message) {
  Write-Host "PASS: $Message" -ForegroundColor Green
}

if (-not (Test-Path $indexPath -PathType Leaf)) {
  throw "Missing application entry point: $indexPath"
}

$html = Get-Content $indexPath -Raw
$scriptSources = [regex]::Matches($html, '<script\s+[^>]*src="([^"]+)"[^>]*>') |
  ForEach-Object { $_.Groups[1].Value } |
  Where-Object { $_ -notmatch '^https?://' }

$missingScripts = @($scriptSources | Where-Object { -not (Test-Path (Join-Path $srcRoot $_) -PathType Leaf) })
if ($missingScripts.Count) {
  Add-Failure "Missing local scripts: $($missingScripts -join ', ')"
} else {
  Add-Pass "All $($scriptSources.Count) local scripts exist"
}

$ids = [regex]::Matches($html, '\bid="([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
$duplicateIds = @($ids | Group-Object | Where-Object Count -gt 1 | Select-Object -ExpandProperty Name)
if ($duplicateIds.Count) {
  Add-Failure "Duplicate HTML IDs: $($duplicateIds -join ', ')"
} else {
  Add-Pass 'HTML IDs are unique'
}

$requiredFeatureIds = @(
  'exportDialog', 'exportConfirmBtn', 'exportCancelBtn', 'exportDialogProgress',
  'includeExportMetadata', 'shapeScale', 'shapeScaleVal', 'rotationLevelDisplay',
  'colorPresetsSection'
)
$missingFeatureIds = @($requiredFeatureIds | Where-Object { $_ -notin $ids })
if ($missingFeatureIds.Count) {
  Add-Failure "Missing feature UI IDs: $($missingFeatureIds -join ', ')"
} else {
  Add-Pass 'Export, overlay, rotation, and preset UI surfaces exist'
}

$controls = [regex]::Matches($html, '<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"[^>]*>')
$forIds = [regex]::Matches($html, '<label\b[^>]*\bfor="([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
$wrappedIds = [regex]::Matches($html, '<label\b[^>]*>\s*<input\b[^>]*\bid="([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
$unlabelled = @($controls | Where-Object {
  $_.Groups[1].Value -notin $forIds -and
  $_.Groups[1].Value -notin $wrappedIds -and
  $_.Value -notmatch '\baria-label='
} | ForEach-Object { $_.Groups[1].Value })
if ($unlabelled.Count) {
  Add-Failure "Unlabelled controls: $($unlabelled -join ', ')"
} else {
  Add-Pass 'Every form control has an accessible name'
}

$jsonFiles = @(Get-ChildItem $ProjectRoot -Recurse -File -Filter *.json)
foreach ($jsonFile in $jsonFiles) {
  try {
    Get-Content $jsonFile.FullName -Raw | ConvertFrom-Json | Out-Null
  } catch {
    Add-Failure "Invalid JSON: $($jsonFile.FullName)"
  }
}
if (-not ($failures | Where-Object { $_ -like 'Invalid JSON:*' })) {
  Add-Pass "All $($jsonFiles.Count) JSON files parse"
}

$jsdocWorkflow = Join-Path $ProjectRoot '.github/workflows/jsdoc.yml'
if (-not (Test-Path $jsdocWorkflow -PathType Leaf)) {
  Add-Failure 'Missing JSDoc workflow'
} elseif ((Get-Content $jsdocWorkflow -Raw) -notmatch 'docs/js') {
  Add-Failure 'JSDoc workflow does not target docs/js'
} else {
  Add-Pass 'JSDoc workflow targets docs/js'
}

$javascriptFiles = @(Get-ChildItem (Join-Path $srcRoot 'js') -Recurse -File -Filter *.js)
$referencedIds = foreach ($file in $javascriptFiles) {
  $content = Get-Content $file.FullName -Raw
  [regex]::Matches($content, '(?:getElementById|\$)\(\s*[''\"]([^''\"]+)[''\"]\s*\)') |
    ForEach-Object { $_.Groups[1].Value }
}
$missingIds = @($referencedIds | Sort-Object -Unique | Where-Object { $_ -notin $ids })
if ($missingIds.Count) {
  Add-Failure "JavaScript references missing HTML IDs: $($missingIds -join ', ')"
} else {
  Add-Pass 'Literal JavaScript DOM references resolve to HTML IDs'
}

$functionDefinitions = foreach ($file in $javascriptFiles) {
  $content = Get-Content $file.FullName -Raw
  foreach ($match in [regex]::Matches($content, '(?m)^\s*function\s+([A-Za-z_$][\w$]*)\s*\(')) {
    [pscustomobject]@{ Name = $match.Groups[1].Value; Path = $file.FullName }
  }
}
$localHelperNames = @('create', 'update')
$duplicateFunctions = @($functionDefinitions |
  Group-Object Path, Name |
  Where-Object { $_.Count -gt 1 -and $_.Group[0].Name -notin $localHelperNames })
if ($duplicateFunctions.Count) {
  $summary = $duplicateFunctions | ForEach-Object { "$($_.Group[0].Name) ($($_.Count))" }
  Add-Failure "Duplicate function declarations: $($summary -join ', ')"
} else {
  Add-Pass 'Function declarations are unique across classic scripts'
}

$nonAsciiComments = [System.Collections.Generic.List[string]]::new()
Get-ChildItem $ProjectRoot -Recurse -File -Include *.js,*.html,*.css,*.md | ForEach-Object {
  $lineNumber = 0
  Get-Content $_.FullName | ForEach-Object {
    $lineNumber += 1
    if ($_ -match '^\s*(//|/\*|\*|<!--|#\s)' -and $_ -match '[^\x00-\x7F]') {
      $nonAsciiComments.Add("$($_.FullName):$lineNumber")
    }
  }
}
if ($nonAsciiComments.Count) {
  Add-Failure "Non-ASCII comment text: $($nonAsciiComments -join ', ')"
} else {
  Add-Pass 'Source comments use plain English ASCII text'
}

if ($failures.Count) {
  Write-Error "Cartiva validation failed with $($failures.Count) issue(s)."
}

Write-Host 'Cartiva validation completed successfully.' -ForegroundColor Cyan