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

  const issues: string[] = []

  if (setup.calendarsMissing) {
    issues.push('rotation calendars are missing for at least one training year')
  }

  if (setup.consultantsWithoutSection > 0) {
    issues.push(
      `${setup.consultantsWithoutSection} consultant${setup.consultantsWithoutSection === 1 ? ' has' : 's have'} no section`,
    )
  }

  if (setup.peopleWithoutAssignment > 0) {
    issues.push(
      `${setup.peopleWithoutAssignment} ${setup.peopleWithoutAssignment === 1 ? 'person has' : 'people have'} no duty assignment covering today`,
    )
  }

  if (issues.length === 0) {
    return null
  }

  return (
    <section
      role="status"
      className="flex flex-col gap-3 rounded-[0.35rem] border border-[#f0b429]/50 bg-[#fff8e8] px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-[#b07d10]" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#1d3047]">Academic setup is incomplete</p>
          <p className="mt-0.5 text-sm leading-6 text-[#74777f]">
            {issues.join('; ')}. Evaluation pairing and the duty roster depend on this data.
          </p>
        </div>
      </div>
      <Link
        to="/admin/academic/structure"
        className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-[#005db6] transition-colors hover:text-[#003f7d]"
      >
        Open structure
        <ArrowUpRight className="h-4 w-4" />
      </Link>
    </section>
  )
}
