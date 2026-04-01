import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Get both from Supabase Dashboard -> Project Settings -> API, then export them before running this script.',
  )
  process.exit(1)
}

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

const demoUsers = [
  {
    email: 'admin1@mesayhospital.demo',
    password: 'Mesay2026!',
    fullName: 'Aster Bekele',
    roleKey: 'admin',
    title: 'Operations Administrator',
  },
  {
    email: 'mesay.gemechu@mesayhospital.demo',
    password: 'Mesay2026!',
    fullName: 'Dr. Mesay Gemechu',
    roleKey: 'doctor_admin',
    title: 'Clinical Director',
  },
  {
    email: 'hana.abera@mesayhospital.demo',
    password: 'Mesay2026!',
    fullName: 'Hana Abera',
    roleKey: 'nurse',
    title: 'Senior Ward Nurse',
  },
  {
    email: 'samuel.hailu@mesayhospital.demo',
    password: 'Mesay2026!',
    fullName: 'Samuel Hailu',
    roleKey: 'nurse',
    title: 'Clinic Nurse',
  },
  {
    email: 'ruth.mamo@mesayhospital.demo',
    password: 'Mesay2026!',
    fullName: 'Ruth Mamo',
    roleKey: 'nurse',
    title: 'Procedure Nurse',
  },
]

for (const user of demoUsers) {
  const created = await adminClient.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: {
      full_name: user.fullName,
      role_key: user.roleKey,
      title: user.title,
    },
  })

  if (created.error && !created.error.message.toLowerCase().includes('already been registered')) {
    console.error(`Failed to create ${user.email}:`, created.error.message)
    process.exitCode = 1
    continue
  }

  const userId = created.data.user?.id

  if (!userId) {
    const lookup = await adminClient.auth.admin.listUsers()
    const existingUser = lookup.data.users.find((candidate) => candidate.email === user.email)
    if (!existingUser) {
      console.error(`Unable to resolve a user id for ${user.email}.`)
      process.exitCode = 1
      continue
    }

    await adminClient.from('profiles').upsert(
      {
        id: existingUser.id,
        email: user.email,
        full_name: user.fullName,
        role_key: user.roleKey,
        title: user.title,
        active: true,
      },
      { onConflict: 'id' },
    )
    continue
  }

  const { error: profileError } = await adminClient.from('profiles').upsert(
    {
      id: userId,
      email: user.email,
      full_name: user.fullName,
      role_key: user.roleKey,
      title: user.title,
      active: true,
    },
    { onConflict: 'id' },
  )

  if (profileError) {
    console.error(`Failed to upsert profile for ${user.email}:`, profileError.message)
    process.exitCode = 1
  } else {
    console.log(`Seeded ${user.email}`)
  }
}
