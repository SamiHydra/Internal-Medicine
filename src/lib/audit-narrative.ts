import type { AdminAuditEntry } from '@/lib/api/types'
import { formatAuditFieldValue, humanizeAuditKey } from '@/lib/dates'

/**
 * Turns one audit row into a sentence a ward manager can read.
 *
 * The trail is written by the code that performs each action, so a row arrives
 * as an action key, an entity type and a bag of changed columns. Printed
 * directly that reads as "Created - User account - Full name: Tewodros Kassa,
 * Role key: nurse", which is a database talking to itself. The same row is
 * "Dr. Alem Woldemariam created the user account for Tewodros Kassa". Nothing
 * is invented here: every part comes from the stored row.
 */

type Verb = {
  /** Lowercase phrase that follows a person's name. */
  verb: string
  /** The phrase already names what was acted on, so no entity noun follows. */
  standalone?: boolean
  tone?: Tone
}

export type Tone = 'create' | 'update' | 'remove' | 'approve' | 'reject' | 'neutral'

const VERBS: Record<string, Verb> = {
  create: { verb: 'created', tone: 'create' },
  upsert: { verb: 'created', tone: 'create' },
  create_draft: { verb: 'drafted', tone: 'create' },
  create_external: { verb: 'added', tone: 'create' },
  update: { verb: 'updated', tone: 'update' },
  update_content: { verb: 'edited the content of', tone: 'update' },
  update_structure: { verb: 'changed the structure of', tone: 'update' },
  delete: { verb: 'removed', tone: 'remove' },
  deactivate: { verb: 'switched off', tone: 'remove' },
  set_field_active: { verb: 'changed a field on', tone: 'update' },
  set_consultant_section: { verb: 'moved to another section', tone: 'update' },
  publish: { verb: 'published', tone: 'create' },
  import: { verb: 'imported', tone: 'create' },
  record: { verb: 'recorded', tone: 'create' },
  record_attendance: { verb: 'recorded attendance for', tone: 'create' },
  submit: { verb: 'submitted', tone: 'create' },
  correct: { verb: 'corrected', tone: 'update' },
  cancel: { verb: 'cancelled', tone: 'remove' },
  request: { verb: 'requested', tone: 'neutral' },
  approve: { verb: 'approved', tone: 'approve' },
  reject: { verb: 'turned down', tone: 'reject' },
  review: { verb: 'reviewed', tone: 'neutral' },
  assign: { verb: 'assigned', tone: 'update' },
  resolve: { verb: 'resolved', tone: 'approve' },
  verify: { verb: 'verified and closed', tone: 'approve' },
  reopen: { verb: 'reopened', tone: 'update' },
  comment: { verb: 'left a note on', tone: 'neutral' },
  upload_evidence: { verb: 'attached evidence to', tone: 'neutral' },
  apply: { verb: 'applied', tone: 'update' },
  reset_password: { verb: 'reset the password for', tone: 'update' },
  approve_admin_request: {
    verb: 'approved an account request',
    standalone: true,
    tone: 'approve',
  },
  reject_admin_request: {
    verb: 'turned down an account request',
    standalone: true,
    tone: 'reject',
  },
  save_roster_month: { verb: 'saved a monthly duty roster', standalone: true, tone: 'update' },
  save_daily_duty: { verb: 'assigned a duty', standalone: true, tone: 'update' },
  remove_daily_duty: { verb: 'cleared a duty', standalone: true, tone: 'remove' },
  save_rotation_plan: { verb: 'saved a rotation plan', standalone: true, tone: 'update' },
}

/**
 * Where the name of the thing lives, best first. `full_name` also decides the
 * preposition: you act on a department, but for a person.
 */
const NAME_KEYS = [
  'full_name',
  'fullName',
  'name',
  'title',
  'label',
  'setting_key',
  'settingKey',
  'cohort',
  'username',
  'email',
] as const

const PERSON_NAME_KEYS = new Set(['full_name', 'fullName'])

/** Column names a reader would never use out loud. */
const FRIENDLY_LABELS: Record<string, string> = {
  role_key: 'Role',
  roleKey: 'Role',
  setting_key: 'Setting',
  bed_count: 'Beds',
  family: 'Service line',
  training_year: 'Year',
  rotation_group: 'Group',
  responsible_role: 'Owner role',
  condition_state: 'State',
}

/** Values already carried by the sentence, or too noisy for a summary chip. */
const SKIPPED_FACT_KEYS = new Set([
  'password',
  'password_change_required',
  'created_at',
  'updated_at',
  'deleted_at',
  'ip_address',
  'user_agent',
])

/**
 * Columns the verb already speaks for. A row deactivating an account stores the
 * state it captured, which is not always the state after the change - so
 * "switched off ... Active" was possible. The action is the authority on what
 * happened; repeating it from a column can only agree or contradict.
 */
const REDUNDANT_FACT_KEYS: Record<string, string[]> = {
  deactivate: ['active'],
  set_active: ['active'],
  delete: ['active'],
  assign: ['status'],
  resolve: ['status'],
  verify: ['status'],
  reopen: ['status'],
  approve: ['status'],
  reject: ['status'],
}

const ID_KEY = /(^|[a-z0-9_])(id|uuid)$/i
const UUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isIdentifier = (key: string, value: unknown) =>
  ID_KEY.test(key) || (typeof value === 'string' && UUID_VALUE.test(value))

/** Long free text belongs in the expanded detail, not in a one-line summary. */
const FACT_VALUE_MAX = 40

export type AuditNarrative = {
  actor: string
  verb: string
  /** "the user account for", or "" when the verb already names its object. */
  object: string
  /** The one thing worth emphasising, when the row names one. */
  name: string | null
  facts: { label: string | null; value: string }[]
  tone: Tone
}

export function describeAuditEntry(entry: AdminAuditEntry): AuditNarrative {
  const values = { ...(entry.oldValues ?? {}), ...(entry.newValues ?? {}) }

  const verb = resolveVerb(entry, values)
  const nameKey = NAME_KEYS.find(
    (key) => typeof values[key] === 'string' && (values[key] as string).trim() !== '',
  )
  const name = nameKey ? String(values[nameKey]).trim() : null

  return {
    actor: entry.userName ?? 'Someone',
    verb: verb.verb,
    object: verb.standalone
      ? ''
      : `the ${entry.entityLabel.toLowerCase()}${
          name && nameKey && PERSON_NAME_KEYS.has(nameKey) ? ' for' : ''
        }`,
    name,
    facts: collectFacts(values, nameKey, REDUNDANT_FACT_KEYS[entry.action] ?? []),
    tone: verb.tone ?? 'neutral',
  }
}

/**
 * `set_active` is one action covering two opposite outcomes, so the row's own
 * value decides which one this was. An unregistered action falls back to the
 * server's label rather than being dropped.
 */
function resolveVerb(entry: AdminAuditEntry, values: Record<string, unknown>): Verb {
  if (entry.action === 'set_active') {
    return values.active === false
      ? { verb: 'switched off', tone: 'remove' }
      : { verb: 'switched on', tone: 'create' }
  }

  return (
    VERBS[entry.action] ?? {
      verb: entry.actionLabel.toLowerCase(),
      tone: 'neutral',
    }
  )
}

/**
 * A bare lowercase word ("high", "outpatient") is a stored option, so it reads
 * better capitalised on a chip. Anything with punctuation - an email, a
 * username, a date - is left as it is.
 */
function sentenceCase(value: string): string {
  return /^[a-z][a-z0-9]*$/.test(value)
    ? value.charAt(0).toUpperCase() + value.slice(1)
    : value
}

/** The name for a stored column, wherever it is shown. */
export function auditFieldLabel(key: string): string {
  return FRIENDLY_LABELS[key] ?? humanizeAuditKey(key)
}

/** A stored option reads better capitalised. Exported for the detail panel. */
export { sentenceCase as auditFieldValueCase }

function collectFacts(
  values: Record<string, unknown>,
  nameKey: string | undefined,
  redundant: string[],
): AuditNarrative['facts'] {
  return Object.entries(values)
    .filter(
      ([key, value]) =>
        key !== nameKey &&
        !SKIPPED_FACT_KEYS.has(key) &&
        !redundant.includes(key) &&
        !isIdentifier(key, value) &&
        value !== null &&
        value !== '' &&
        (typeof value !== 'string' || value.length <= FACT_VALUE_MAX) &&
        typeof value !== 'object',
    )
    .slice(0, 3)
    .map(([key, value]) => {
      // A yes/no column says everything in its own name: "Active", not
      // "Active: Yes". "Not active" is clearer than "Active: No".
      if (typeof value === 'boolean') {
        const label = auditFieldLabel(key)
        return { label: null, value: value ? label : `Not ${label.toLowerCase()}` }
      }

      return {
        label: auditFieldLabel(key),
        value: sentenceCase(formatAuditFieldValue(value)),
      }
    })
}
