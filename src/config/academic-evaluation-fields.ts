// Single source of truth for the academic-evaluation option lists and indicator
// labels. These MUST mirror the backend allowed-value lists
// (ConsultantEvaluation::SCORE_ITEMS / ResidentEvaluation::SCORE_ITEMS and the
// form-options enums). The submit form and the admin detail panel both read from
// here so a label only ever lives in one place.

// --- multi-select option lists ----------------------------------------------

export const MDT_PARTICIPANT_OPTIONS = [
  { value: 'consultant', label: 'Consultant' },
  { value: 'fellow', label: 'Fellow' },
  { value: 'internist', label: 'Internist' },
  { value: 'residents', label: 'Residents' },
  { value: 'interns', label: 'Interns' },
  { value: 'nurse', label: 'Nurse' },
  { value: 'clinical_pharmacy', label: 'Clinical pharmacy' },
] as const

export const SYSTEM_ISSUE_OPTIONS = [
  { value: 'lab_delay', label: 'Lab delay' },
  { value: 'imaging_delay', label: 'Imaging delay' },
  { value: 'staff_shortage', label: 'Staff shortage' },
  { value: 'bed_issue', label: 'Bed issue' },
  { value: 'emr_interruption', label: 'EMR interruption' },
  { value: 'communication_issue', label: 'Communication issue' },
] as const

export const CONCERN_OPTIONS = [
  { value: 'punctuality', label: 'Punctuality' },
  { value: 'preparation', label: 'Preparation' },
  { value: 'medical_knowledge', label: 'Medical knowledge' },
  { value: 'clinical_reasoning', label: 'Clinical reasoning' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'communication', label: 'Communication' },
  { value: 'professionalism', label: 'Professionalism' },
  { value: 'follow_through', label: 'Follow-through' },
  { value: 'time_management', label: 'Time management' },
] as const

export const OVERALL_RATING_OPTIONS = [
  { value: '1', label: '1 · Well below expectations' },
  { value: '2', label: '2 · Below expectations' },
  { value: '3', label: '3 · Meets expectations' },
  { value: '4', label: '4 · Above expectations' },
  { value: '5', label: '5 · Excellent' },
] as const

// --- boolean indicator fields -----------------------------------------------
// The `name`s are keys that exist on BOTH the form values and the serialized
// record, so the same list drives the submit form's toggles and the detail
// panel's met/not-met readout.

export type ConsultantIndicatorField =
  | 'allPatientsReviewed'
  | 'mgmtPlanDocumented'
  | 'vteAssessed'
  | 'dischargeDiscussed'
  | 'medReviewDone'
  | 'criticalLabsReviewed'

export type ResidentIndicatorField =
  | 'onTime'
  | 'prepared'
  | 'presentationClear'
  | 'clinicalReasoning'
  | 'managementPlan'
  | 'documentationTimely'
  | 'communication'
  | 'professional'
  | 'responsiveFeedback'
  | 'followThrough'

export const CONSULTANT_SCORE_ITEMS: { name: ConsultantIndicatorField; label: string }[] = [
  { name: 'allPatientsReviewed', label: 'All patients reviewed' },
  { name: 'mgmtPlanDocumented', label: 'Management plan documented' },
  { name: 'vteAssessed', label: 'VTE risk assessed' },
  { name: 'dischargeDiscussed', label: 'Discharge discussed' },
  { name: 'medReviewDone', label: 'Medication review done' },
  { name: 'criticalLabsReviewed', label: 'Critical labs reviewed' },
]

export const RESIDENT_COMPETENCIES: {
  group: string
  items: { name: ResidentIndicatorField; label: string }[]
}[] = [
  {
    group: 'Attendance & professionalism',
    items: [
      { name: 'onTime', label: 'Present & on time' },
      { name: 'professional', label: 'Professional conduct' },
    ],
  },
  {
    group: 'Preparation & patient care',
    items: [
      { name: 'prepared', label: 'Knew patients; list & overnight events updated' },
      { name: 'managementPlan', label: 'Appropriate, prioritized plan' },
    ],
  },
  {
    group: 'Medical knowledge',
    items: [{ name: 'clinicalReasoning', label: 'Sound assessment & differential' }],
  },
  {
    group: 'Communication',
    items: [
      { name: 'presentationClear', label: 'Case presentation clear & concise' },
      { name: 'communication', label: 'Effective with team / nursing / patient' },
    ],
  },
  {
    group: 'Documentation & systems',
    items: [
      { name: 'documentationTimely', label: 'Notes & orders complete and timely' },
      { name: 'followThrough', label: 'Completed tasks; chased results & referrals' },
    ],
  },
  {
    group: 'Practice-based learning',
    items: [{ name: 'responsiveFeedback', label: 'Receptive to feedback & teaching' }],
  },
]

// --- helpers ----------------------------------------------------------------

type Option = { value: string; label: string }

/** Map a stored value to its human label, falling back to the raw value. */
export function optionLabel(options: ReadonlyArray<Option>, value: string): string {
  return options.find((option) => option.value === value)?.label ?? value
}

/** Map a list of stored values to their human labels. */
export function optionLabels(options: ReadonlyArray<Option>, values: string[]): string[] {
  return values.map((value) => optionLabel(options, value))
}

/** The descriptor half of an overall rating (e.g. "Above expectations"). */
export function overallRatingDescriptor(rating: number | null | undefined): string | null {
  if (rating == null) {
    return null
  }
  const option = OVERALL_RATING_OPTIONS.find((entry) => entry.value === String(rating))
  if (!option) {
    return null
  }
  const [, descriptor] = option.label.split(' · ')
  return descriptor ?? option.label
}
