import { describe, expect, it } from 'vitest'

import {
  parseReportedMetrics,
  stripFollowUpBoilerplate,
} from '@/lib/action-item-description'

const LEGACY =
  'Chest reported: Number of New Deaths (2), Number of Patients Who Developed New Pressure Ulcer (1), Total Number of Patients With Hospital-acquired infections (AIs) (7), Ventilator-associated pneumonia (VAP) (1). Investigate and document the follow-up.'

describe('stripFollowUpBoilerplate', () => {
  it('drops the instruction that ends every generated description', () => {
    expect(
      stripFollowUpBoilerplate('Cardiac reported 7. Investigate and document the follow-up.'),
    ).toBe('Cardiac reported 7.')
    expect(
      stripFollowUpBoilerplate(
        'Cardiac reported 7. Investigate, document the follow-up, and verify closure.',
      ),
    ).toBe('Cardiac reported 7.')
  })

  it('leaves a description that has no boilerplate untouched', () => {
    expect(stripFollowUpBoilerplate('Three wards have not submitted.')).toBe(
      'Three wards have not submitted.',
    )
  })
})

describe('parseReportedMetrics', () => {
  it('recovers each metric and its count', () => {
    expect(parseReportedMetrics(LEGACY)).toEqual({
      lead: 'Chest',
      metrics: [
        { label: 'Number of New Deaths', count: '2' },
        { label: 'Number of Patients Who Developed New Pressure Ulcer', count: '1' },
        {
          // The metric's own brackets survive; only the trailing count is taken.
          label: 'Total Number of Patients With Hospital-acquired infections (AIs)',
          count: '7',
        },
        { label: 'Ventilator-associated pneumonia (VAP)', count: '1' },
      ],
    })
  })

  it('handles a single metric and a department name carrying a slash', () => {
    expect(
      parseReportedMetrics(
        'GI/Neurology reported: Number of New Deaths (1). Investigate and document the follow-up.',
      ),
    ).toEqual({
      lead: 'GI/Neurology',
      metrics: [{ label: 'Number of New Deaths', count: '1' }],
    })
  })

  it('declines anything that is not the generated list', () => {
    // A half-parsed description would read worse than the plain sentence, so
    // every one of these has to fall back rather than render partially.
    expect(parseReportedMetrics(null)).toBeNull()
    expect(parseReportedMetrics('')).toBeNull()
    expect(parseReportedMetrics('Three wards have not submitted for two weeks.')).toBeNull()
    expect(
      parseReportedMetrics('Chest reported 7. The configured rule is greater than 0.'),
    ).toBeNull()
    expect(parseReportedMetrics('Chest reported: Number of New Deaths')).toBeNull()
  })
})
