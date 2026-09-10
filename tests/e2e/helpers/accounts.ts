/**
 * Seeded LOCAL dev accounts (backend/database/seeders/DevUserSeeder.php).
 * All share the dev password. These never exist in production (the seeder
 * no-ops outside the local environment), so using them here is safe.
 */
export const DEV_PASSWORD = 'StPaul2026!'
/**
 * Password for accounts the suite creates itself (registrations, minted admins).
 * Production raises the policy to 12 characters, so this stays valid when the
 * suite runs against a production-shaped target (playwright.external.config.ts).
 */
export const QA_ACCOUNT_PASSWORD = 'StPaul2026!qa'

export type Role = 'superadmin' | 'nurse' | 'resident' | 'consultant'
export type AccountKey = Role | 'non_recorder' | 'group_rep' | 'subgroup_a_rep' | 'subgroup_b_rep'

export type Account = {
  role: AccountKey
  identifier: string // email (login accepts email or username)
  username: string
  fullName: string
  /** Path the app lands on right after login for this role. */
  landing: string
}

export const ACCOUNTS: Record<AccountKey, Account> = {
  superadmin: {
    role: 'superadmin',
    identifier: 'admin@stpaulos.local',
    username: 'admin1',
    fullName: "St Paul's Admin",
    landing: '/admin',
  },
  nurse: {
    role: 'nurse',
    identifier: 'abel.gemechu@stpaulhospital.demo',
    username: 'abel.gemechu',
    fullName: 'Abel Gemechu',
    landing: '/nurse',
  },
  resident: {
    role: 'resident',
    identifier: 'rediet.bekele@stpaulhospital.demo',
    username: 'rediet.bekele',
    fullName: 'Dr. Rediet Bekele',
    landing: '/academic',
  },
  consultant: {
    role: 'consultant',
    identifier: 'chaltu.tesfaye@stpaulhospital.demo',
    username: 'chaltu.tesfaye',
    fullName: 'Dr. Chaltu Tesfaye',
    landing: '/academic',
  },
  non_recorder: {
    role: 'non_recorder',
    identifier: 'samuel.alemu@stpaulhospital.demo',
    username: 'samuel.alemu',
    fullName: 'Dr. Samuel Alemu',
    landing: '/academic',
  },
  group_rep: {
    role: 'group_rep',
    identifier: 'student.rep.group@stpaulos.local',
    username: 'student.rep.group',
    fullName: 'Group Student Representative',
    landing: '/teaching',
  },
  subgroup_a_rep: {
    role: 'subgroup_a_rep',
    identifier: 'student.rep.a@stpaulos.local',
    username: 'student.rep.a',
    fullName: 'Subgroup A Student Representative',
    landing: '/teaching',
  },
  subgroup_b_rep: {
    role: 'subgroup_b_rep',
    identifier: 'student.rep.b@stpaulos.local',
    username: 'student.rep.b',
    fullName: 'Subgroup B Student Representative',
    landing: '/teaching',
  },
}

/** Marker prefix for any data created by this QA suite. */
export const QA_MARKER = 'QA_TEST_DO_NOT_DEPLOY'
