import { describe, expect, it } from 'vitest';

import type { RosterPerson } from '@/lib/api';

import {
  matchesRosterRoleFilter,
  rosterRoleFilters,
} from '@/lib/duty-roster-filters';

function person(overrides: Partial<RosterPerson>): RosterPerson {
  return {
    id: 'person-1',
    fullName: 'Roster Person',
    role: 'resident',
    title: 'Resident',
    sectionId: null,
    sectionName: null,
    trainingYear: 1,
    rotationGroup: null,
    rotationManaged: false,
    rotationBlocks: [],
    monthly: [],
    daily: [],
    ...overrides,
  };
}

describe('duty roster grade filters', () => {
  it('offers every requested grade in senior-to-junior order', () => {
    expect(rosterRoleFilters.map((filter) => filter.label)).toEqual([
      'Consultants',
      'Internists',
      'F2 · Fellow 2',
      'F1 · Fellow 1',
      'Residents Y3',
      'Residents Y2',
      'Residents Y1',
      'Interns',
    ]);
  });

  it('classifies specialized titles without duplicating them in generic grades', () => {
    const internist = person({ role: 'consultant', title: 'Internist' });
    const firstYearFellow = person({ title: 'F1', trainingYear: 1 });
    const secondYearFellow = person({ title: 'Fellow 2', trainingYear: 2 });
    const intern = person({ title: 'Intern', trainingYear: null });

    expect(matchesRosterRoleFilter(internist, 'internist')).toBe(true);
    expect(matchesRosterRoleFilter(internist, 'consultant')).toBe(false);
    expect(matchesRosterRoleFilter(firstYearFellow, 'fellow-1')).toBe(true);
    expect(matchesRosterRoleFilter(firstYearFellow, 'resident-1')).toBe(false);
    expect(matchesRosterRoleFilter(secondYearFellow, 'fellow-2')).toBe(true);
    expect(matchesRosterRoleFilter(secondYearFellow, 'resident-2')).toBe(false);
    expect(matchesRosterRoleFilter(intern, 'intern')).toBe(true);
  });
});
