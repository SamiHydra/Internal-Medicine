param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('database', 'redis')]
    [string]$Driver
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$env:AUDIT_CACHE_STORE = $Driver
$env:AUDIT_SESSION_DRIVER = $Driver
$env:AUDIT_QUEUE_CONNECTION = $Driver
$env:AUDIT_SESSION_CONNECTION = if ($Driver -eq 'redis') { 'default' } else { '' }
$env:AUDIT_REDIS_PERSISTENT = if ($Driver -eq 'redis') { 'true' } else { 'false' }
docker compose up -d --force-recreate app queue web

$deadline = (Get-Date).AddMinutes(5)
do {
    $health = docker inspect --format '{{.State.Health.Status}}' imreport-audit-web-1 2>$null
    if ($health -eq 'healthy') { break }
    if ((Get-Date) -gt $deadline) { throw 'Audit web stack did not become healthy.' }
    Start-Sleep -Seconds 3
} while ($true)

docker compose exec -T app php /audit/reset-transient.php
$actual = docker compose exec -T app php -r "echo getenv('CACHE_STORE'),'|',getenv('SESSION_DRIVER'),'|',getenv('SESSION_CONNECTION'),'|',getenv('QUEUE_CONNECTION'),'|persistent=',getenv('REDIS_PERSISTENT'),PHP_EOL;"

$evidenceDirectory = Join-Path $PSScriptRoot 'evidence'
New-Item -ItemType Directory -Force -Path $evidenceDirectory | Out-Null
[ordered]@{
    requestedDriver = $Driver
    containerEnvironment = $actual.Trim()
    switchedAt = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json | Out-File -LiteralPath (Join-Path $evidenceDirectory "driver-$Driver.json") -Encoding utf8

Write-Output "Driver switched: $actual"
