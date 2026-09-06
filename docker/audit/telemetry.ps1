param(
    [Parameter(Mandatory = $true)][string]$RunDirectory,
    [Parameter(Mandatory = $true)][ValidateSet('database', 'redis')][string]$Driver,
    [int]$IntervalSeconds = 10
)

$ErrorActionPreference = 'Continue'
$composeDirectory = $PSScriptRoot
$outputPath = Join-Path $RunDirectory 'telemetry.jsonl'
$stopPath = Join-Path $RunDirectory 'telemetry.stop'
Set-Location $composeDirectory

function Convert-PairsToHash {
    param([string[]]$Lines)
    $result = [ordered]@{}
    foreach ($line in $Lines) {
        $parts = $line -split "`t", 2
        if ($parts.Count -eq 2) {
            $result[$parts[0]] = $parts[1]
        }
    }
    return $result
}

while (-not (Test-Path -LiteralPath $stopPath)) {
    $capturedAt = (Get-Date).ToUniversalTime().ToString('o')

    $containerStats = @()
    $containerIds = @(docker compose ps -q 2>$null)
    if ($containerIds.Count -gt 0) {
        foreach ($line in @(docker stats --no-stream --format '{{json .}}' $containerIds 2>$null)) {
            try { $containerStats += ($line | ConvertFrom-Json) } catch {}
        }
    }

    $fpm = $null
    try {
        $fpmRaw = curl.exe -sk --max-time 3 'https://localhost:18443/fpm-status?json'
        $fpm = $fpmRaw | ConvertFrom-Json
    } catch {}

    $rssKb = @()
    foreach ($line in @(docker top imreport-audit-app-1 -eo pid,rss,args 2>$null | Select-Object -Skip 1)) {
        $parts = $line.Trim() -split '\s+', 3
        $parsed = 0
        if ($parts.Count -ge 3 -and $parts[2] -eq 'php-fpm: pool www' -and [int]::TryParse($parts[1], [ref]$parsed)) {
            $rssKb += $parsed
        }
    }

    $dbStatusLines = @(docker compose exec -T db mariadb -N -B -uroot -paudit-root-local-only -e @'
SHOW GLOBAL STATUS WHERE Variable_name IN (
  'Threads_connected','Threads_running','Aborted_connects',
  'Innodb_buffer_pool_read_requests','Innodb_buffer_pool_reads',
  'Created_tmp_tables','Created_tmp_disk_tables','Innodb_row_lock_waits',
  'Innodb_row_lock_time','Questions','Slow_queries'
);
'@ 2>$null)
    $dbStatus = Convert-PairsToHash $dbStatusLines

    $dbVariables = Convert-PairsToHash @(docker compose exec -T db mariadb -N -B -uroot -paudit-root-local-only -e "SHOW GLOBAL VARIABLES WHERE Variable_name IN ('max_connections','innodb_buffer_pool_size');" 2>$null)

    $queue = [ordered]@{ depth = 0; oldestAgeSeconds = 0 }
    if ($Driver -eq 'database') {
        $queueLine = @(docker compose exec -T db mariadb -N -B -uroot -paudit-root-local-only imreport_audit -e "SELECT COUNT(*), COALESCE(UNIX_TIMESTAMP()-MIN(available_at),0) FROM jobs;" 2>$null) | Select-Object -First 1
        if ($queueLine) {
            $parts = $queueLine -split "`t"
            $queue.depth = [int]$parts[0]
            $queue.oldestAgeSeconds = [int]$parts[1]
        }
    } else {
        $depth = @(docker compose exec -T redis redis-cli LLEN queues:default 2>$null) | Select-Object -Last 1
        if ($depth -match '^\d+$') { $queue.depth = [int]$depth }
    }

    $redis = $null
    if ($Driver -eq 'redis') {
        $redisInfo = Convert-PairsToHash @(
            docker compose exec -T redis sh -lc "redis-cli INFO stats | grep -E '^(total_commands_processed|instantaneous_ops_per_sec|rejected_connections|keyspace_hits|keyspace_misses):' | tr ':' '\t'" 2>$null
        )
        $pingRaw = @(docker compose exec -T app php /audit/redis-ping.php 2>$null) | Select-Object -Last 1
        $pingMs = 0.0
        [double]::TryParse($pingRaw, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$pingMs) | Out-Null
        $redis = [ordered]@{ pingMs = $pingMs; info = $redisInfo }
    }

    $record = [ordered]@{
        capturedAt = $capturedAt
        containers = $containerStats
        fpm = $fpm
        fpmWorkerRssKb = $rssKb
        database = [ordered]@{ status = $dbStatus; variables = $dbVariables }
        redis = $redis
        queue = $queue
    }
    Add-Content -LiteralPath $outputPath -Value ($record | ConvertTo-Json -Depth 8 -Compress)
    Start-Sleep -Seconds $IntervalSeconds
}
