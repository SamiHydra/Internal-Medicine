import { Link } from 'react-router-dom'
import { ArrowUpRight, TriangleAlert } from 'lucide-react'

import { useAppData } from '@/context/app-data-context'

/**
 * Admin setup signals for the academic pillar (V2 guide 4.7): shown while the
 * workspace bootstrap reports missing rotation calendars, consultants without
 * a section, or people without a duty assignment. Renders nothing once setup
 * is complete, so the dashboard stays calm in steady state.
 */
export function AcademicSetupBanner() {
  const { academic } = useAppData()
  const setup = academic?.academicSetup

  if (!setup) {
    return null
  }

  const issues: Array<{ text: string; href: string; action: string }> = []

  if (setup.calendarsMissing) {
    issues.push({
      text: 'rotation calendars are missing for at least one training year',
      href: '/admin/academic/rotations',
      action: 'Open rotations',
    })
  }

  if (setup.consultantsWithoutSection > 0) {
    issues.push({
      text: `${setup.consultantsWithoutSection} consultant${setup.consultantsWithoutSection === 1 ? ' has' : 's have'} no section`,
      href: '/admin/academic/structure?tab=sections&issue=consultants-without-section#section-gaps',
      action: 'Assign section',
    })
  }

  if (setup.peopleWithoutAssignment > 0) {
    issues.push({
      text: `${setup.peopleWithoutAssignment} ${setup.peopleWithoutAssignment === 1 ? 'person has' : 'people have'} no monthly assignment covering today`,
      href: '/admin/academic/roster?issue=missing-monthly-coverage#coverage-gaps',
      action: 'Assign coverage',
    })
  }

  if (setup.mixedRotationCells > 0) {
    issues.push({
      text: `${setup.mixedRotationCells} current rotation ${setup.mixedRotationCells === 1 ? 'cell has' : 'cells have'} mixed or partial coverage`,
      href: '/admin/academic/rotations',
      action: 'Review rotations',
    })
  } else if (setup.rotationCellsNeedingReview > 0) {
    issues.push({
      text: `${setup.rotationCellsNeedingReview} current rotation ${setup.rotationCellsNeedingReview === 1 ? 'cell is' : 'cells are'} still sourced outside the rotation plan`,
      href: '/admin/academic/rotations',
      action: 'Review rotations',
    })
  }

  if (setup.activeRotationOverrides > 0) {
    issues.push({
      text: `${setup.activeRotationOverrides} resident rotation ${setup.activeRotationOverrides === 1 ? 'override is' : 'overrides are'} active today`,
      href: '/admin/academic/roster',
      action: 'Review overrides',
    })
  }

  if (issues.length === 0) {
    return null
  }

  const actions = Array.from(
    new Map(issues.map((issue) => [issue.href, issue])).values(),
  )

  return (
    <section
      role="status"
      className="flex flex-col gap-3 rounded-[0.35rem] border border-[#f0b429]/50 bg-[#fff8e8] px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-[#b07d10]" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#1d3047]">Scheduling health needs attention</p>
          <p className="mt-0.5 text-sm leading-6 text-[#74777f]">
            {issues.map((issue) => issue.text).join('; ')}. Evaluation pairing and morning attendance use this effective coverage.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
        {actions.map((action) => (
          <Link
            key={action.href}
            to={action.href}
            className="inline-flex items-center gap-1 text-sm font-semibold text-[#005db6] transition-colors hover:text-[#003f7d]"
          >
            {action.action}
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        ))}
      </div>
    </section>
  )
}
