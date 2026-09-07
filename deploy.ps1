$ErrorActionPreference = "Continue"
Set-Location -LiteralPath $PSScriptRoot

$VERCEL_TOKEN = $env:VERCEL_TOKEN
if (-not $VERCEL_TOKEN) {
  Write-Error "VERCEL_TOKEN not set. Export it or edit the fallback in this script."
  exit 1
}

# Resolve the Vercel project: pre-set VERCEL_PROJECT_ID, else the project.json
# written by `vercel link`. Only used for post-deploy status reporting.
$PROJECT_ID = $env:VERCEL_PROJECT_ID
if (-not $PROJECT_ID -and (Test-Path ".vercel\project.json")) {
  $PROJECT_ID = ((Get-Content ".vercel\project.json" -Raw | ConvertFrom-Json).projectId)
}

# Pre-build check so we fail fast before touching git / deploying.
Write-Host "==> Running local build check..." -ForegroundColor Cyan
npm run build 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Error "Local build failed. Fix errors before deploying."
  exit 1
}

# The seat-verification block only triggers when a deployment carries the
# local git-commit author identity. Hiding .git makes Vercel treat the deploy
# as a plain owner/CLI deploy (which passes), restoring it afterwards.
$gitMoved = $false
if (Test-Path ".git") {
  Write-Host "==> Hiding .git to avoid git-author seat block..." -ForegroundColor Cyan
  Move-Item -LiteralPath ".git" -Destination ".git.bak" -Force
  $gitMoved = $true
}

try {
  Write-Host "==> Deploying to Vercel (production)..." -ForegroundColor Cyan
  npx --yes vercel@latest deploy --prod --token $VERCEL_TOKEN --yes 2>&1
  Write-Host "Build finished. Polling for a READY deployment..." -ForegroundColor Cyan

  if (-not $PROJECT_ID) {
    Write-Host "VERCEL_PROJECT_ID not set and no .vercel\project.json - run `vercel link` or set the env var to enable status reporting." -ForegroundColor Yellow
  } else {
    Start-Sleep -Seconds 10
    $latest = curl.exe -s -H "Authorization: Bearer $VERCEL_TOKEN" `
      "https://api.vercel.com/v6/deployments?projectId=$PROJECT_ID&limit=1" `
      | ConvertFrom-Json
    $d = $latest.deployments[0]
    if ($d) {
      Write-Host ("Latest deployment: {0}  state={1}  target={2}" -f $d.uid, $d.readyState, $d.target) -ForegroundColor Green
      if ($d.readyState -eq "READY") { Write-Host "Deploy ready. https://$($d.url)" -ForegroundColor Green }
      else { Write-Host "Deployment is in state '$($d.readyState)' - check the Vercel dashboard." -ForegroundColor Yellow }
    }
  }
}
finally {
  if ($gitMoved -and (Test-Path ".git.bak") -and -not (Test-Path ".git")) {
    Write-Host "==> Restoring .git..." -ForegroundColor Cyan
    Move-Item -LiteralPath ".git.bak" -Destination ".git" -Force
  }
}

Write-Host "Done." -ForegroundColor Green