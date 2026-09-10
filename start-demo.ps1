# ---------------------------------------------------------------------------
# St Paul's — DEMO launcher (serves the PRODUCTION build locally)
#
# The production build is ~4x lighter on the main thread than `npm run dev`
# (no unminified module parsing), so it presents much faster. This script
# starts the Laravel API + the built SPA and opens the browser.
#
#   Run from the project root:   .\start-demo.ps1
#   Login:                       admin@stpaulos.local  /  StPaul2026!
#   URL:                         http://localhost:4173
#
# If you CHANGED CODE since the last build, rebuild first (one line):
#   $env:VITE_API_BASE_URL="http://localhost:4173"; npm run build
#
# To present with an instant dashboard, open it once before the demo so the
# analytics cache is warm (the very first load after a restart builds it ~1s;
# every load after that is instant).
# ---------------------------------------------------------------------------
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "Starting Laravel API on :8000 ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend'; php artisan serve --host=127.0.0.1 --port=8000"

Write-Host "Starting production SPA (vite preview) on :4173 ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root'; npm run preview -- --port 4173"

Write-Host "Waiting for servers to come up ..." -ForegroundColor Cyan
Start-Sleep -Seconds 6

Start-Process "http://localhost:4173"
Write-Host ""
Write-Host "Demo is up:  http://localhost:4173" -ForegroundColor Green
Write-Host "Login:       admin@stpaulos.local  /  StPaul2026!" -ForegroundColor Green
Write-Host ""
Write-Host "(If a window says 'port already in use', that server was already running - fine.)" -ForegroundColor DarkGray
