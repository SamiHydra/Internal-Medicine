param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][ValidateSet('database', 'redis')][string]$Driver,
    [Parameter(Mandatory = $true)][int]$Users,
    [Parameter(Mandatory = $true)][int]$DurationSeconds,
    [Parameter(Mandatory = $true)][int]$RampSeconds,
    [int]$ThinkMinMs = 250,
    [int]$ThinkMaxMs = 1200,
    [ValidateSet('standard', 'spike')][string]$Profile = 'standard'
)

$ErrorActionPreference = 'Stop'
$composeDirectory = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runDirectory = Join-Path $PSScriptRoot "evidence\runs\$Driver\$Name"
New-Item -ItemType Directory -Force -Path $runDirectory | Out-Null
Set-Location $composeDirectory

docker compose exec -T app php /audit/reset-transient.php | Out-File -LiteralPath (Join-Path $runDirectory 'reset.txt') -Encoding utf8
docker compose exec -T db mariadb -uroot -paudit-root-local-only -e "SET GLOBAL slow_query_log='OFF'; TRUNCATE TABLE mysql.slow_log; SET GLOBAL slow_query_log='ON';" | Out-Null
docker compose exec -T db mariadb -N -B -uroot -paudit-root-local-only -e "SHOW GLOBAL STATUS;" |
    Out-File -LiteralPath (Join-Path $runDirectory 'db-status-before.tsv') -Encoding utf8

$readyPath = Join-Path $runDirectory 'load.ready'
$goPath = Join-Path $runDirectory 'load.go'
$outputPath = Join-Path $runDirectory 'load.json'
$stdoutPath = Join-Path $runDirectory 'load.stdout.log'
$stderrPath = Join-Path $runDirectory 'load.stderr.log'
$telemetryStopPath = Join-Path $runDirectory 'telemetry.stop'

$env:NODE_TLS_REJECT_UNAUTHORIZED = '0'
$env:LOAD_BASE_URL = 'https://localhost:18443'
$env:LOAD_FRONTEND_ORIGIN = 'https://localhost:18443'
$env:LOAD_USERS = [string]$Users
$env:LOAD_DURATION_SECONDS = [string]$DurationSeconds
$env:LOAD_RAMP_SECONDS = [string]$RampSeconds
$env:LOAD_THINK_MIN_MS = [string]$ThinkMinMs
$env:LOAD_THINK_MAX_MS = [string]$ThinkMaxMs
$env:LOAD_REQUEST_TIMEOUT_MS = '15000'
$env:LOAD_PROFILE = $Profile
$env:LOAD_CREDENTIALS_FILE = (Join-Path $PSScriptRoot 'evidence\load-credentials.csv')
$env:LOAD_OUTPUT = $outputPath
$env:LOAD_READY_FILE = $readyPath
$env:LOAD_GO_FILE = $goPath

$loadProcess = Start-Process -FilePath 'node.exe' `
    -ArgumentList @('docker/audit/load-test.mjs') `
    -WorkingDirectory $repoRoot `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -WindowStyle Hidden `
    -PassThru

$readyDeadline = (Get-Date).AddMinutes(8)
while (-not (Test-Path -LiteralPath $readyPath)) {
    if ($loadProcess.HasExited) {
        throw "Load setup exited before ready; inspect $stderrPath"
    }
    if ((Get-Date) -gt $readyDeadline) {
        Stop-Process -Id $loadProcess.Id
        throw "Load setup did not become ready within eight minutes."
    }
    Start-Sleep -Seconds 2
}

$telemetryProcess = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', (Join-Path $PSScriptRoot 'telemetry.ps1'),
        '-RunDirectory', $runDirectory,
        '-Driver', $Driver,
        '-IntervalSeconds', '10'
    ) `
    -WorkingDirectory $composeDirectory `
    -WindowStyle Hidden `
    -PassThru

New-Item -ItemType File -Path $goPath -Force | Out-Null
$loadProcess.WaitForExit()
$loadProcess.Refresh()
$loadExitCode = $loadProcess.ExitCode
if ($null -eq $loadExitCode) {
    if (Test-Path -LiteralPath $outputPath) {
        $loadResult = Get-Content -LiteralPath $outputPath -Raw | ConvertFrom-Json
        $loadExitCode = if ([double]$loadResult.errorRate -gt 0.01) { 1 } else { 0 }
    } else {
        $loadExitCode = -1
    }
}
New-Item -ItemType File -Path $telemetryStopPath -Force | Out-Null

if (-not $telemetryProcess.WaitForExit(30000)) {
    Stop-Process -Id $telemetryProcess.Id
}

docker compose exec -T db mariadb -N -B -uroot -paudit-root-local-only -e "SHOW GLOBAL STATUS;" |
    Out-File -LiteralPath (Join-Path $runDirectory 'db-status-after.tsv') -Encoding utf8
docker compose exec -T db mariadb -N -B -uroot -paudit-root-local-only -e @'
SELECT start_time, query_time, lock_time, rows_sent, rows_examined, db, sql_text
FROM mysql.slow_log ORDER BY start_time;
'@ | Out-File -LiteralPath (Join-Path $runDirectory 'slow-log.tsv') -Encoding utf8
docker compose logs --no-color --since 30m app queue |
    Out-File -LiteralPath (Join-Path $runDirectory 'service.log') -Encoding utf8

$completion = [ordered]@{
    name = $Name
    driver = $Driver
    users = $Users
    durationSeconds = $DurationSeconds
    rampSeconds = $RampSeconds
    profile = $Profile
    loadExitCode = $loadExitCode
    completedAt = (Get-Date).ToUniversalTime().ToString('o')
    output = $outputPath
}
$completion | ConvertTo-Json | Out-File -LiteralPath (Join-Path $runDirectory 'complete.json') -Encoding utf8
$completion | ConvertTo-Json
