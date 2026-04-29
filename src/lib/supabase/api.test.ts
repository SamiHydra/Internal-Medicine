import { describe, expect, it } from 'vitest'

import { departments, templateMap } from '@/config/templates'
import {
  resolveAssignmentReference,
  type SupabaseReferenceState,
} from '@/lib/supabase/api'

describe('resolveAssignmentReference', () => {
  it('resolves Dialysis department and template IDs for assignment creation', () => {
    const dialysisDepartment = departments.find((department) => department.name === 'Dialysis')
    const dialysisTemplate = templateMap.dialysis_weekly
    const references: SupabaseReferenceState = {
      departmentDbIdBySlug: {
        dialysis_unit: 'department-db-id',
      },
      templateDbIdBySlug: {
        dialysis_weekly: 'template-db-id',
      },
      templateDbIdByDepartmentSlug: {
        dialysis_unit: 'template-db-id',
      },
    }

    expect(dialysisDepartment?.id).toBe('dialysis_unit')
    expect(dialysisTemplate.name).toBe('Dialysis')
    expect(
      resolveAssignmentReference(
        references,
        dialysisDepartment!.id,
        dialysisDepartment!.templateId,
      ),
    ).toEqual({
      departmentId: 'department-db-id',
      templateId: 'template-db-id',
    })
  })

  it('does not resolve Dialysis when the Supabase template reference is missing', () => {
    const references: SupabaseReferenceState = {
      departmentDbIdBySlug: {
        dialysis_unit: 'department-db-id',
      },
      templateDbIdBySlug: {},
      templateDbIdByDepartmentSlug: {},
    }

    expect(resolveAssignmentReference(references, 'dialysis_unit', 'dialysis_weekly')).toBeNull()
  })

  it('resolves Transition inpatient department and template IDs for assignment creation', () => {
    const transitionDepartment = departments.find((department) => department.name === 'Transition')
    const inpatientTemplate = templateMap.inpatient_weekly
    const references: SupabaseReferenceState = {
      departmentDbIdBySlug: {
        transition_inpatient: 'transition-department-db-id',
      },
      templateDbIdBySlug: {
        inpatient_weekly: 'inpatient-template-db-id',
      },
      templateDbIdByDepartmentSlug: {
        transition_inpatient: 'inpatient-template-db-id',
      },
    }

    expect(transitionDepartment?.id).toBe('transition_inpatient')
    expect(transitionDepartment?.family).toBe('inpatient')
    expect(transitionDepartment?.templateId).toBe('inpatient_weekly')
    expect(inpatientTemplate.family).toBe('inpatient')
    expect(
      resolveAssignmentReference(
        references,
        transitionDepartment!.id,
        transitionDepartment!.templateId,
      ),
    ).toEqual({
      departmentId: 'transition-department-db-id',
      templateId: 'inpatient-template-db-id',
    })
  })
})
