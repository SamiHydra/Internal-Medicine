import type { RosterPerson } from '@/lib/api';

export const rosterRoleFilters = [
  { value: 'consultant', label: 'Consultants' },
  { value: 'internist', label: 'Internists' },
  { value: 'fellow-2', label: 'F2 · Fellow 2' },
  { value: 'fellow-1', label: 'F1 · Fellow 1' },
  { value: 'resident-3', label: 'Residents Y3' },
  { value: 'resident-2', label: 'Residents Y2' },
  { value: 'resident-1', label: 'Residents Y1' },
  { value: 'intern', label: 'Interns' },
] as const;

export type RosterRoleFilter = (typeof rosterRoleFilters)[number]['value'];

type SpecializedRosterGrade = 'intern' | 'internist' | 'fellow-1' | 'fellow-2';

function specializedRosterGrade(person: RosterPerson): SpecializedRosterGrade | null {
  const title = (person.title ?? '')
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ');

  if (/^interns?$/.test(title)) {
    return 'intern';
  }

  if (/^internists?$/.test(title)) {
    return 'internist';
  }

  if (/^(?:f2|fellow 2|fellow ii)$/.test(title)) {
    return 'fellow-2';
  }

  if (/^(?:f1|fellow 1|fellow i)$/.test(title)) {
    return 'fellow-1';
  }

  if (/^fellows?$/.test(title) && (person.trainingYear === 1 || person.trainingYear === 2)) {
    return `fellow-${person.trainingYear}`;
  }

  return null;
}

export function matchesRosterRoleFilter(
  person: RosterPerson,
  filter: RosterRoleFilter,
): boolean {
  const specializedGrade = specializedRosterGrade(person);

  if (filter === 'consultant') {
    return person.role === 'consultant' && specializedGrade !== 'internist';
  }

  if (filter === 'internist') {
    return person.role === 'consultant' && specializedGrade === 'internist';
  }

  if (filter === 'intern') {
    return person.role === 'resident' && specializedGrade === 'intern';
  }

  if (filter === 'fellow-1' || filter === 'fellow-2') {
    return person.role === 'resident' && specializedGrade === filter;
  }

  const yearWanted = Number(filter.split('-')[1]);
  return (
    person.role === 'resident' &&
    specializedGrade === null &&
    person.trainingYear === yearWanted
  );
}
