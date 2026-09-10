import { motion } from 'framer-motion'
import { Activity, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { HeaderChip, panelClass, SectionHeader } from '@/components/dashboard/section-panel'
import { Button } from '@/components/ui/button'
import { getApiBrowserClient } from '@/lib/api/client'
import { fetchSystemHealth } from '@/lib/api/admin'
import type { SystemHealthCheck, SystemHealthSnapshot } from '@/lib/api/types'
import { formatTimestamp } from '@/lib/dates'
import { cn } from '@/lib/utils'

const statusTone: Record<SystemHealthCheck['status'], string> = {
  pass: 'border-[#cfe7d9] bg-[#edf7f0] text-[#1f6b3b]',
  warn: 'border-[#f0d9aa] bg-[#fbf4e6] text-[#8a5a00]',
  fail: 'border-[#f1d1d1] bg-[#fff1f1] text-[#9d2a2a]',
}

const statusLabel: Record<SystemHealthCheck['status'], string> = {
  pass: 'PASS',
  warn: 'WARN',
  fail: 'FAIL',
}

const overallTone: Record<SystemHealthSnapshot['status'], string> = {
  healthy: statusTone.pass,
  degraded: statusTone.warn,
  unhealthy: statusTone.fail,
}

function ageLabel(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) {
    return 'never'
  }

  if (seconds < 90) {
    return `${seconds} s ago`
  }

  if (seconds < 5400) {
    return `${Math.round(seconds / 60)} min ago`
  }

  return `${(seconds / 3600).toFixed(1)} h ago`
}

function hoursLabel(hours: number | null | undefined) {
  if (hours === null || hours === undefined) {
    return 'none found'
  }

  return `${hours} h ago`
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[0.3rem] border border-[#e6ecf3] bg-[#f8fafc] px-3.5 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#666970]">{label}</p>
      <p className="mt-1.5 break-words text-sm font-semibold text-[#000a1e]">{value}</p>
    </div>
  )
}

/**
 * Maintenance-only operational view (docs/OBSERVABILITY.md, "System health").
 * Mirrors `php artisan app:launch-readiness` for an operator who is not at the
 * server console: states, ages and counts only; the API never returns secrets.
 */
export function SystemHealthPage() {
  const [snapshot, setSnapshot] = useState<SystemHealthSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const load = useCallback(async () => {
    const client = getApiBrowserClient()
    if (!client) {
      setError('The API is not configured.')
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    try {
      setSnapshot(await fetchSystemHealth(client))
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load the health snapshot.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const counters = snapshot?.observability.counters ?? {}
  const counter = (key: string) => counters[key]?.lastHour ?? 0

  return (
    <div className="space-y-6 px-4 py-6 md:px-6 md:py-8">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={panelClass}
      >
        <SectionHeader
          eyebrow="Maintenance"
          title="System health"
          description={
            snapshot
              ? `Checked ${formatTimestamp(snapshot.checkedAt)} · release ${snapshot.release.sha}`
              : 'Operational state of this deployment, read live from the server.'
          }
          actions={
            <>
              {snapshot ? (
                <span
                  data-testid="system-health-status"
                  className={cn(
                    'inline-flex items-center gap-2 rounded-[0.25rem] border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em]',
                    overallTone[snapshot.status],
                  )}
                >
                  <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                  {snapshot.status}
                </span>
              ) : null}
              <Button size="sm" variant="secondary" onClick={() => void load()} disabled={isLoading}>
                <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} aria-hidden="true" />
                Refresh
              </Button>
            </>
          }
        />

        {error ? (
          <p role="alert" className="mt-5 rounded-[0.35rem] border border-[#f1d1d1] bg-[#fff1f1] px-4 py-3 text-sm text-[#9d2a2a]">
            {error}
          </p>
        ) : null}

        {snapshot ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Fact label="Release" value={`${snapshot.release.sha}${snapshot.release.builtAt ? ` · ${formatTimestamp(snapshot.release.builtAt)}` : ''}`} />
            <Fact label="Environment" value={`${snapshot.application.environment} · PHP ${snapshot.application.phpVersion}`} />
            <Fact
              label="Database"
              value={
                snapshot.database.connected
                  ? `${snapshot.database.driver} connected · ${snapshot.database.latencyMs ?? '?'} ms`
                  : `${snapshot.database.driver} unreachable`
              }
            />
            <Fact label="Scheduler heartbeat" value={ageLabel(snapshot.scheduler.ageSeconds)} />
            <Fact
              label="Pending jobs"
              value={String(snapshot.queue.queues.reduce((total, queue) => total + queue.depth, 0))}
            />
            <Fact
              label="Failed jobs (24h / total)"
              value={`${snapshot.queue.failedJobs.last24h ?? '?'} / ${snapshot.queue.failedJobs.total ?? '?'}`}
            />
            <Fact label="Last database backup" value={hoursLabel(snapshot.backups.latestDump.ageHours)} />
            <Fact label="Last storage backup" value={hoursLabel(snapshot.backups.latestStorageArchive.ageHours)} />
            <Fact
              label="Storage"
              value={`${snapshot.storage.writable ? 'writable' : 'NOT writable'} · ${snapshot.storage.freeDiskGb ?? '?'} GB free`}
            />
            <Fact
              label="Mail transport"
              value={snapshot.transports.mail.configured ? snapshot.transports.mail.driver : 'Not configured'}
            />
            <Fact
              label="SMS transport"
              value={snapshot.transports.sms.configured ? snapshot.transports.sms.driver : 'Not configured'}
            />
            <Fact
              label="Errors in the last hour"
              value={`${counter('exceptions') + counter('serverErrors')} server · ${counter('clientErrors')} client · ${counter('slowRequests')} slow`}
            />
          </div>
        ) : null}
      </motion.section>

      {snapshot ? (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut', delay: 0.04 }}
          className={panelClass}
        >
          <SectionHeader
            eyebrow="Checks"
            title="Readiness checks"
            description="The same signals as php artisan app:launch-readiness, evaluated now."
            actions={
              <HeaderChip>
                {snapshot.checks.filter((check) => check.status !== 'pass').length} attention
              </HeaderChip>
            }
          />
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <caption className="sr-only">Readiness checks with their current status</caption>
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-[#666970]">
                  <th scope="col" className="border-b border-[#e6ecf3] py-2 pr-3">Status</th>
                  <th scope="col" className="border-b border-[#e6ecf3] py-2 pr-3">Check</th>
                  <th scope="col" className="border-b border-[#e6ecf3] py-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.checks.map((check) => (
                  <tr key={check.key} data-testid={`health-check-${check.key}`}>
                    <td className="border-b border-[#eef2f6] py-2 pr-3">
                      <span
                        className={cn(
                          'inline-block rounded-[0.25rem] border px-2 py-0.5 text-[11px] font-semibold tracking-[0.12em]',
                          statusTone[check.status],
                        )}
                      >
                        {statusLabel[check.status]}
                      </span>
                    </td>
                    <th scope="row" className="border-b border-[#eef2f6] py-2 pr-3 text-left font-medium text-[#000a1e]">
                      {check.label}
                    </th>
                    <td className="border-b border-[#eef2f6] py-2 text-[#5b6169]">{check.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.section>
      ) : null}

      {snapshot ? (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut', delay: 0.08 }}
          className={panelClass}
        >
          <SectionHeader
            eyebrow="Queues"
            title="Queue depth and age"
            description={`Warns above ${snapshot.queue.thresholds.depth} waiting jobs or ${snapshot.queue.thresholds.oldestJobAgeSeconds} s of age · worker mode ${snapshot.queue.workerMode}`}
          />
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {snapshot.queue.queues.map((queue) => (
              <Fact
                key={queue.name}
                label={`Queue ${queue.name}`}
                value={`${queue.depth} waiting · oldest ${queue.oldestJobAgeSeconds === null ? '-' : `${queue.oldestJobAgeSeconds} s`}`}
              />
            ))}
          </div>
        </motion.section>
      ) : null}
    </div>
  )
}
