import { ArrowUpRight, GraduationCap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { fetchAcademicSummary } from '@/lib/api/academic'
import { getApiBrowserClient } from '@/lib/api/client'
import type { AcademicSummary } from '@/lib/api/types'

/**
 * A compact bridge from the clinical dashboard into the separate Academic
 * section. Keeps the two dashboards distinct (different domains) while giving
 * admins an at-a-glance read and one-click entry. Solid navy to signal a
 * different section without competing with the clinical cards.
 */
export function AcademicSnapshotCard() {
  const client = getApiBrowserClient()
  const [consultant, setConsultant] = useState<AcademicSummary | null>(null)
  const [resident, setResident] = useState<AcademicSummary | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    client ? 'loading' : 'error',
  )

  useEffect(() => {
    if (!client) {
      return
    }

    let active = true

    Promise.all([
      fetchAcademicSummary(client, { direction: 'consultant' }),
      fetchAcademicSummary(client, { direction: 'resident' }),
    ])
      .then(([consultantSummary, residentSummary]) => {
        if (!active) {
          return
        }
        setConsultant(consultantSummary)
        setResident(residentSummary)
        setStatus('ready')
      })
      .catch(() => {
        if (active) {
          setStatus('error')
        }
      })

    return () => {
      active = false
    }
  }, [client])

  const stats = [
    {
      label: 'Consultant evals',
      count: consultant?.evaluationCount ?? 0,
      score: consultant ? `${Math.round(consultant.averageScore)}%` : '—',
    },
    {
      label: 'Resident evals',
      count: resident?.evaluationCount ?? 0,
      score:
        resident?.avgOverallRating != null
          ? `${resident.avgOverallRating.toFixed(1)}/5`
          : resident
            ? `${Math.round(resident.averageScore)}%`
            : '—',
    },
  ]

  return (
    <Link
      to="/admin/academic"
      className="group block rounded-[0.35rem] bg-[#04162f] px-5 py-5 text-white outline outline-1 outline-[#0c2747] transition-[transform,background-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[#06203f] motion-safe:active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-[0.3rem] bg-[#005db6]">
            <GraduationCap className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#f0b429]">
              Academic
            </p>
            <p className="text-sm font-semibold text-white/90">MDT round evaluations</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9fb4d0] transition-colors group-hover:text-white">
          Open
          <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-[0.3rem] bg-white/[0.05] px-3.5 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9fb4d0]">
              {stat.label}
            </p>
            <p
              className="mt-2 font-display text-[1.4rem] leading-none tracking-[-0.03em] text-white"
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              {status === 'loading' ? '…' : stat.count}
            </p>
            <p className="mt-1 text-xs text-[#c6d3e4]">
              {status === 'error' ? 'Unavailable' : `Avg ${stat.score}`}
            </p>
          </div>
        ))}
      </div>
    </Link>
  )
}
