/**
 * Seeded LOCAL dev accounts (backend/database/seeders/DevUserSeeder.php).
 * All share the dev password. These never exist in production (the seeder
 * no-ops outside the local environment), so using them here is safe.
 */
export const DEV_PASSWORD = 'StPaul2026!'

export type Role = 'superadmin' | 'nurse' | 'resident' | 'consultant'

export type Account = {
  role: Role
  identifier: string // email (login accepts email or username)
  username: string
  fullName: string
  /** Path the app lands on right after login for this role. */
  landing: string
}

export const ACCOUNTS: Record<Role, Account> = {
  superadmin: {
    role: 'superadmin',
    identifier: 'admin@stpaulos.local',
    username: 'admin1',
    fullName: 'St Paul Admin',
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
}

/** Marker prefix for any data created by this QA suite. */
export const QA_MARKER = 'QA_TEST_DO_NOT_DEPLOY'
