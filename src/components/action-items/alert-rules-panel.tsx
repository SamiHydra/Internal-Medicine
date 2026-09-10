import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { BellRing, Loader2, Plus, Save, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'

import { panelClass, SectionEmptyState } from '@/components/dashboard/section-panel'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  createClinicalAlertRule,
  fetchClinicalAlertRules,
  updateClinicalAlertRule,
} from '@/lib/api/admin'
import type { LaravelApiClient } from '@/lib/api/client'
import type { ClinicalAlertRule, ClinicalAlertRuleTemplateOption } from '@/lib/api/types'

type Props = { client: LaravelApiClient | null }
type RuleRole = 'admin' | 'superadmin'

const operatorLabel = { gt: 'Greater than', gte: 'At least', eq: 'Exactly' } as const

function RoleChecks({ value, onChange }: { value: RuleRole[]; onChange: (roles: RuleRole[]) => void }) {
  const toggle = (role: RuleRole, checked: boolean) => {
    const next = checked ? [...new Set([...value, role])] : value.filter((entry) => entry !== role)
    if (next.length) onChange(next)
  }
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-4 rounded-[0.25rem] border border-[#d4dde8] bg-white px-3">
      {(['admin', 'superadmin'] as RuleRole[]).map((role) => <label key={role} className="flex items-center gap-2 text-xs font-semibold text-[#1d3047]"><Checkbox checked={value.includes(role)} onCheckedChange={(checked) => toggle(role, checked === true)} />{role === 'admin' ? 'Admins' : 'Superadmins'}</label>)}
    </div>
  )
}

function RuleRow({ rule, client, onSaved }: { rule: ClinicalAlertRule; client: LaravelApiClient; onSaved: () => Promise<void> }) {
  const [operator, setOperator] = useState(rule.operator)
  const [threshold, setThreshold] = useState(String(rule.threshold))
  const [severity, setSeverity] = useState(rule.severity)
  const [deadlineHours, setDeadlineHours] = useState(String(rule.deadlineHours))
  const [responsibleRole, setResponsibleRole] = useState<RuleRole>(rule.responsibleRole ?? 'admin')
  const [notificationRoles, setNotificationRoles] = useState<RuleRole[]>(rule.notificationRoles.length ? rule.notificationRoles : ['admin', 'superadmin'])
  const [active, setActive] = useState(rule.active)
  const [pending, setPending] = useState(false)

  const save = async () => {
    if (!client || !notificationRoles.length) return
    setPending(true)
    try {
      await updateClinicalAlertRule(client, rule.id, {
        operator, threshold: Number(threshold), severity, deadline_hours: Number(deadlineHours),
        responsible_role: responsibleRole, notification_roles: notificationRoles, active,
      })
      toast.success(`${rule.fieldLabel} rule saved.`)
      await onSaved()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to save the alert rule.')
    } finally { setPending(false) }
  }

  return (
    <motion.article layout className="border-t border-[#dbe3ec] py-5 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
        <div className="min-w-0 2xl:w-52 2xl:shrink-0">
          <div className="flex items-start gap-2"><span className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${active ? "bg-[#1f6b3b]" : "bg-[#9aa0a8]"}`} /><p className="font-display text-base font-bold text-[#000a1e]">{rule.fieldLabel}</p></div>
          <p className="mt-1 text-xs text-[#657180]">{rule.templateName} · version {rule.version}</p>
          <p className="mt-2 break-words font-mono text-[11px] text-[#666970]">{rule.fieldKey}</p>
        </div>
        <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-[152px_88px_112px_100px_128px_minmax(164px,340px)_auto]">
          <label className="space-y-1.5"><Label>Trigger</Label><Select value={operator} onValueChange={(value) => setOperator(value as typeof operator)}><SelectTrigger aria-label={`${rule.fieldLabel} trigger`}><SelectValue /></SelectTrigger><SelectContent>{Object.entries(operatorLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label>
          <label className="space-y-1.5"><Label>Value</Label><Input type="number" min="0" step="0.01" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></label>
          <label className="space-y-1.5"><Label>Severity</Label><Select value={severity} onValueChange={(value) => setSeverity(value as typeof severity)}><SelectTrigger aria-label={`${rule.fieldLabel} severity`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select></label>
          <label className="space-y-1.5"><Label>Due hours</Label><Input type="number" min="1" max="8760" value={deadlineHours} onChange={(event) => setDeadlineHours(event.target.value)} /></label>
          <label className="space-y-1.5"><Label>Owner role</Label><Select value={responsibleRole} onValueChange={(value) => setResponsibleRole(value as RuleRole)}><SelectTrigger aria-label={`${rule.fieldLabel} owner role`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="superadmin">Superadmin</SelectItem></SelectContent></Select></label>
          <label className="space-y-1.5"><Label>Notify</Label><RoleChecks value={notificationRoles} onChange={setNotificationRoles} /></label>
          <div className="flex items-end gap-2"><label className="mb-2.5 flex items-center gap-2 text-xs font-semibold text-[#526171]"><Switch checked={active} onCheckedChange={setActive} aria-label={`${rule.fieldLabel} active`} />Active</label><Button type="button" size="icon" disabled={pending || !threshold || !deadlineHours} onClick={() => void save()} aria-label={`Save ${rule.fieldLabel} rule`}>{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}</Button></div>
        </div>
      </div>
    </motion.article>
  )
}

export function AlertRulesPanel({ client }: Props) {
  const [rules, setRules] = useState<ClinicalAlertRule[]>([])
  const [templates, setTemplates] = useState<ClinicalAlertRuleTemplateOption[]>([])
  const [loading, setLoading] = useState(Boolean(client))
  const [showCreate, setShowCreate] = useState(false)
  const [pending, setPending] = useState(false)
  const [templateId, setTemplateId] = useState('')
  const [fieldId, setFieldId] = useState('')
  const [operator, setOperator] = useState<'gt' | 'gte' | 'eq'>('gt')
  const [threshold, setThreshold] = useState('0')
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high'>('high')
  const [deadlineHours, setDeadlineHours] = useState('24')
  const [responsibleRole, setResponsibleRole] = useState<RuleRole>('admin')
  const [notificationRoles, setNotificationRoles] = useState<RuleRole[]>(['admin', 'superadmin'])

  const load = useCallback(async () => {
    if (!client) return
    setLoading(true)
    try {
      const result = await fetchClinicalAlertRules(client)
      setRules(result.rules); setTemplates(result.templates)
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Unable to load alert rules.') }
    finally { setLoading(false) }
  }, [client])

  useEffect(() => { void load() }, [load])
  const selectedTemplate = templates.find((template) => template.id === templateId)
  const availableFields = useMemo(() => selectedTemplate?.fields.filter((field) => !rules.some((rule) => rule.templateId === templateId && rule.fieldKey === field.fieldKey)) ?? [], [selectedTemplate, rules, templateId])

  const create = async () => {
    if (!client || !templateId || !fieldId) { toast.error('Choose a report and clinical field.'); return }
    setPending(true)
    try {
      await createClinicalAlertRule(client, { template_id: templateId, field_definition_id: fieldId, operator, threshold: Number(threshold), severity, deadline_hours: Number(deadlineHours), responsible_role: responsibleRole, notification_roles: notificationRoles })
      toast.success('Clinical alert rule created.')
      setShowCreate(false); setFieldId(''); await load()
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Unable to create the alert rule.') }
    finally { setPending(false) }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-b border-[#dbe3ec] pb-5 md:flex-row md:items-end md:justify-between">
        <div><h2 className="font-display text-xl font-bold tracking-[-0.02em] text-[#000a1e]">Clinical alert rules</h2><p className="mt-1 text-sm text-[#657180]">Set the trigger, priority, deadline, and owner.</p></div>
        <Button onClick={() => setShowCreate((value) => !value)}><Plus className="h-4 w-4" />Add alert rule</Button>
      </header>

      {showCreate ? <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={panelClass}>
        <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-[0.3rem] bg-[#fdecec] text-[#ba1a1a]"><ShieldAlert className="h-4 w-4" /></span><div><h3 className="font-display text-base font-bold text-[#000a1e]">New clinical alert</h3><p className="mt-1 text-sm text-[#657180]">Choose the report field and follow-up settings.</p></div></div>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-2"><Label>Report template</Label><Select value={templateId} onValueChange={(value) => { setTemplateId(value); setFieldId('') }}><SelectTrigger aria-label="Alert rule template"><SelectValue placeholder="Choose report" /></SelectTrigger><SelectContent>{templates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}</SelectContent></Select></label>
          <label className="space-y-2"><Label>Clinical field</Label><Select value={fieldId} onValueChange={setFieldId}><SelectTrigger aria-label="Alert rule field"><SelectValue placeholder="Choose field" /></SelectTrigger><SelectContent>{availableFields.map((field) => <SelectItem key={field.id} value={field.id}>{field.label}</SelectItem>)}</SelectContent></Select></label>
          <label className="space-y-2"><Label>Trigger</Label><Select value={operator} onValueChange={(value) => setOperator(value as typeof operator)}><SelectTrigger aria-label="New rule trigger"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(operatorLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label>
          <label className="space-y-2"><Label>Threshold</Label><Input type="number" min="0" step="0.01" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></label>
          <label className="space-y-2"><Label>Severity</Label><Select value={severity} onValueChange={(value) => setSeverity(value as typeof severity)}><SelectTrigger aria-label="New rule severity"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select></label>
          <label className="space-y-2"><Label>Response deadline (hours)</Label><Input type="number" min="1" max="8760" value={deadlineHours} onChange={(event) => setDeadlineHours(event.target.value)} /></label>
          <label className="space-y-2"><Label>Responsible role</Label><Select value={responsibleRole} onValueChange={(value) => setResponsibleRole(value as RuleRole)}><SelectTrigger aria-label="New rule responsible role"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="superadmin">Superadmin</SelectItem></SelectContent></Select></label>
          <label className="space-y-2"><Label>Notification recipients</Label><RoleChecks value={notificationRoles} onChange={setNotificationRoles} /></label>
        </div>
        <div className="mt-5 flex gap-2"><Button disabled={pending || !fieldId || !deadlineHours} onClick={() => void create()}>{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}Create rule</Button><Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button></div>
      </motion.section> : null}

      {loading ? <div className={panelClass}><Loader2 className="h-5 w-5 animate-spin text-[#005db6]" /></div> : rules.length === 0 ? <SectionEmptyState icon={<ShieldAlert className="h-7 w-7" />} title="No clinical alert rules" description="Add a rule to turn a submitted clinical value into governed follow-up work." /> : client ? <section className={panelClass}>{rules.map((rule) => <RuleRow key={`${rule.id}:${rule.version}`} rule={rule} client={client} onSaved={load} />)}</section> : null}
    </div>
  )
}
