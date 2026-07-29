param(
    [string]$EvidenceRoot = (Join-Path $PSScriptRoot 'evidence')
)

$ErrorActionPreference = 'Stop'

function Get-Percentile {
    param([double[]]$Values, [double]$Percent)
    if (-not $Values -or $Values.Count -eq 0) { return 0 }
    $sorted = @($Values | Sort-Object)
    $index = [Math]::Min($sorted.Count - 1, [Math]::Ceiling(($Percent / 100) * $sorted.Count) - 1)
    return [double]$sorted[$index]
}

function Get-Delta {
    param($First, $Last, [string]$Name)
    if ($null -eq $First -or $null -eq $Last) { return 0 }
    return [double]$Last.database.status.$Name - [double]$First.database.status.$Name
}

$summaries = @()
$runsRoot = Join-Path $EvidenceRoot 'runs'
foreach ($loadFile in @(Get-ChildItem -LiteralPath $runsRoot -Recurse -Filter 'load.json' -File -ErrorAction SilentlyContinue)) {
    $runDirectory = $loadFile.Directory
    $driver = $runDirectory.Parent.Name
    $result = Get-Content -LiteralPath $loadFile.FullName -Raw | ConvertFrom-Json

    $telemetry = @()
    $telemetryPath = Join-Path $runDirectory.FullName 'telemetry.jsonl'
    if (Test-Path -LiteralPath $telemetryPath) {
        foreach ($line in @(Get-Content -LiteralPath $telemetryPath)) {
            try { $telemetry += ($line | ConvertFrom-Json) } catch {}
        }
    }

    $rssMb = @(
        $telemetry |
            ForEach-Object { $_.fpmWorkerRssKb } |
            Where-Object { $null -ne $_ } |
            ForEach-Object { [double]$_ / 1024 }
    )
    $first = $telemetry | Select-Object -First 1
    $last = $telemetry | Select-Object -Last 1
    $readRequests = Get-Delta $first $last 'Innodb_buffer_pool_read_requests'
    $reads = Get-Delta $first $last 'Innodb_buffer_pool_reads'
    $hitRatio = if ($readRequests -gt 0) { 1 - ($reads / $readRequests) } else { 1 }

    $endpoints = [ordered]@{}
    foreach ($property in $result.endpoints.psobject.Properties) {
        $row = $property.Value
        $endpoints[$property.Name] = [ordered]@{
            count = $row.count
            ok = $row.ok
            failed = $row.failed
            errorRate = $row.errorRate
            p50Ms = $row.p50Ms
            p95Ms = $row.p95Ms
            p99Ms = $row.p99Ms
            maxMs = $row.maxMs
        }
    }

    $summaries += [ordered]@{
        driver = $driver
        name = $runDirectory.Name
        users = $result.users
        durationSeconds = $result.durationSeconds
        rampSeconds = $result.rampSeconds
        profile = $result.profile
        totalRequests = $result.totalRequests
        totalOk = $result.totalOk
        totalFailures = $result.totalFailures
        errorRate = $result.errorRate
        successfulRps = $result.successfulRps
        endpoints = $endpoints
        telemetry = [ordered]@{
            snapshots = $telemetry.Count
            fpmWorkerRssP95Mb = [Math]::Round((Get-Percentile $rssMb 95), 2)
            fpmWorkerRssMaxMb = if ($rssMb.Count) { [Math]::Round(($rssMb | Measure-Object -Maximum).Maximum, 2) } else { 0 }
            fpmActiveMax = @($telemetry.fpm.'active processes' | Measure-Object -Maximum).Maximum
            fpmListenQueueMax = @($telemetry.fpm.'listen queue' | Measure-Object -Maximum).Maximum
            fpmMaxChildrenReachedMax = @($telemetry.fpm.'max children reached' | Measure-Object -Maximum).Maximum
            fpmMaxChildrenReachedDelta = if ($telemetry.Count) {
                [int](@($telemetry.fpm.'max children reached' | Measure-Object -Maximum).Maximum) -
                    [int]$first.fpm.'max children reached'
            } else { 0 }
            dbThreadsConnectedMax = @($telemetry.database.status.Threads_connected | ForEach-Object { [int]$_ } | Measure-Object -Maximum).Maximum
            dbThreadsRunningMax = @($telemetry.database.status.Threads_running | ForEach-Object { [int]$_ } | Measure-Object -Maximum).Maximum
            dbAbortedConnectsDelta = Get-Delta $first $last 'Aborted_connects'
            dbBufferPoolHitRatio = [Math]::Round($hitRatio, 8)
            dbTmpDiskTablesDelta = Get-Delta $first $last 'Created_tmp_disk_tables'
            dbRowLockWaitsDelta = Get-Delta $first $last 'Innodb_row_lock_waits'
            queueDepthMax = @($telemetry.queue.depth | Measure-Object -Maximum).Maximum
            queueOldestAgeMaxSeconds = @($telemetry.queue.oldestAgeSeconds | Measure-Object -Maximum).Maximum
            redisPingP95Ms = if ($driver -eq 'redis') {
                [Math]::Round((Get-Percentile @($telemetry.redis.pingMs | ForEach-Object { [double]$_ }) 95), 3)
            } else { $null }
        }
    }
}

$output = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    runs = @($summaries | Sort-Object driver, name)
}
$outputPath = Join-Path $EvidenceRoot 'run-summary.json'
$output | ConvertTo-Json -Depth 12 | Out-File -LiteralPath $outputPath -Encoding utf8
$output | ConvertTo-Json -Depth 5
