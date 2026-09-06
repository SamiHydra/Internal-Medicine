import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react'
import { addHours, format, parseISO } from 'date-fns'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  FileUp,
  History,
  Loader2,
  MessageSquareText,
  RotateCcw,
  Save,
  ShieldCheck,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import {
  addActionItemComment,
  createActionItem,
  updateActionItem,
  uploadActionItemEvidence,
} from '@/lib/api/admin'
import type { LaravelApiClient } from '@/lib/api/client'
import type { ActionItem, ActionItemStatus } from '@/lib/api/types'
import type { Department, UserProfile } from '@/types/domain'
import {
  parseReportedMetrics,
  stripFollowUpBoilerplate,
} from '@/lib/action-item-description'
import { cn } from '@/lib/utils'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: ActionItem | null
  creating: boolean
  client: LaravelApiClient | null
  managers: UserProfile[]
  departments: Department[]
  onChanged: () => Promise<void>
  onCreated: () => Promise<void>
}

function localDateTime(value: string | null) {
  const date = value ? parseISO(value) : addHours(new Date(), 24)
  return Number.isNaN(date.getTime()) ? '' : format(date, "yyyy-MM-dd'T'HH:mm")
}

const PILL =
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em]'

const STATUS_TONE: Record<ActionItemStatus, { label: string; pill: string }> = {
  open: { label: 'Open', pill: 'bg-white text-[#9f1717] ring-1 ring-[#f3cccc]' },
  assigned: { label: 'Assigned', pill: 'bg-white text-[#00468c] ring-1 ring-[#cfe0f4]' },
  in_progress: { label: 'In progress', pill: 'bg-white text-[#815600] ring-1 ring-[#f0d9aa]' },
  resolved: { label: 'Resolved', pill: 'bg-white text-[#1f6b3b] ring-1 ring-[#bfe0cb]' },
  closed: { label: 'Verified', pill: 'bg-white text-[#44474e] ring-1 ring-[#d4dde8]' },
}

/**
 * Severity sets the temperature of the whole panel: the header wash, the
 * severity pill, and the count badges beside each measure. One table so a
 * high-severity action never reads half-urgent.
 */
const SEVERITY_TONE = {
  high: {
    label: 'High',
    pill: 'bg-[#ba1a1a] text-white',
    wash: 'bg-[linear-gradient(135deg,#fff1f1_0%,#fff8f8_42%,#ffffff_100%)]',
    count: 'bg-[#fdecec] text-[#9f1717]',
  },
  medium: {
    label: 'Medium',
    pill: 'bg-[#8a5a00] text-white',
    wash: 'bg-[linear-gradient(135deg,#fdf6e9_0%,#fefbf4_42%,#ffffff_100%)]',
    count: 'bg-[#fbf4e6] text-[#815600]',
  },
  low: {
    label: 'Low',
    pill: 'bg-[#00468c] text-white',
    wash: 'bg-[linear-gradient(135deg,#eef5fc_0%,#f7fafd_42%,#ffffff_100%)]',
    count: 'bg-[#edf4fb] text-[#00468c]',
  },
} as const

/** The brand rule from the sign-in hero, tying the panel to the rest of the app. */
const BRAND_RULE =
  'h-px w-20 bg-[linear-gradient(90deg,#005db6_0%,#63a1ff_68%,#f0b429_100%)]'

/** "in 3 days" / "2 days ago" - urgency belongs next to the deadline, not in a column. */
function deadlineHint(dueAt: string | null, overdue: boolean): string | null {
  if (!dueAt) return null

  const due = parseISO(dueAt)
  if (Number.isNaN(due.getTime())) return null

  const hours = Math.round(Math.abs(Date.now() - due.getTime()) / 3_600_000)
  const span = hours < 48 ? `${hours}h` : `${Math.round(hours / 24)} days`

  return overdue ? `${span} overdue` : `${span} left`
}

function readableEvent(event: string) {
  const labels: Record<string, string> = {
    opened: 'Opened', assigned: 'Owner assigned', status_changed: 'Status changed',
    investigation_started: 'Started',
    resolved: 'Resolved', verified: 'Verified', reopened: 'Reopened',
    data_corrected: 'Value corrected', condition_recurred: 'Condition recurred',
    commented: 'Note added', evidence_uploaded: 'Evidence uploaded', overdue: 'Overdue',
  }
  return labels[event] ?? event.replaceAll('_', ' ')
}

/**
 * The generated description is a metric list wearing a paragraph's clothes.
 * Show it as the list it is; keep the original sentence for screen readers so
 * the record still reads as one statement.
 */
function ReportedSummary({
  description,
  tone,
}: {
  description: string
  tone: (typeof SEVERITY_TONE)[keyof typeof SEVERITY_TONE]
}) {
  const parsed = parseReportedMetrics(description)

  if (!parsed) {
    return (
      <SheetDescription className="leading-6 text-[#657180]">
        {stripFollowUpBoilerplate(description)}
      </SheetDescription>
    )
  }

  return (
    <>
      <SheetDescription className="sr-only">{description}</SheetDescription>
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#526171]">
        {parsed.lead} reported
        <span className="text-[#9aa6b5]"> · </span>
        {parsed.metrics.length} measure{parsed.metrics.length === 1 ? '' : 's'}
      </p>
      <ul className="mt-2 space-y-1">
        {parsed.metrics.map((metric) => (
          <li
            key={metric.label}
            className="flex items-center justify-between gap-4 rounded-[0.35rem] bg-white/70 px-3 py-2 ring-1 ring-inset ring-[#e9eef4]"
          >
            <span className="min-w-0 text-[13px] leading-5 text-[#1d3047]">
              {metric.label}
            </span>
            <span
              className={cn(
                'shrink-0 rounded-[0.3rem] px-2 py-0.5 font-display text-sm font-bold tabular-nums',
                tone.count,
              )}
            >
              {metric.count}
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

function DetailSection({ title, icon: Icon, children }: { title: string; icon: typeof History; children: ReactNode }) {
  return (
    <section className="border-t border-[#eaeff5] pt-5">
      <h3 className="flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#1d3047]">
        <span className="flex h-7 w-7 items-center justify-center rounded-[0.4rem] bg-[#edf4fb] text-[#005db6]">
          <Icon className="h-3.5 w-3.5" />
        </span>
        {title}
      </h3>
      <div className="mt-3.5">{children}</div>
    </section>
  )
}

export function ActionItemSheet(props: Props) {
  const { open, onOpenChange, item, creating, client, managers, departments, onChanged, onCreated } = props
  const [pending, setPending] = useState(false)
  const [assignee, setAssignee] = useState('unassigned')
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high'>('medium')
  const [dueAt, setDueAt] = useState('')
  const [resolutionNote, setResolutionNote] = useState('')
  const [comment, setComment] = useState('')
  const [createValues, setCreateValues] = useState({ title: '', description: '', departmentId: '', assignedTo: '', dueAt: localDateTime(null), severity: 'medium' as 'low' | 'medium' | 'high' })

  useEffect(() => {
    if (!item) return
    setAssignee(item.assignedTo ?? 'unassigned')
    setSeverity(item.severity)
    setDueAt(localDateTime(item.dueAt))
    setResolutionNote(item.resolutionNote ?? '')
  }, [item])

  const mutate = async (payload: Parameters<typeof updateActionItem>[2], success: string) => {
    if (!client || !item) return
    setPending(true)
    try {
      await updateActionItem(client, item.id, payload)
      toast.success(success)
      await onChanged()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to update the action item.')
    } finally {
      setPending(false)
    }
  }

  const transition = (status: ActionItemStatus) => mutate(
    { status, ...(status === 'in_progress' && assignee !== 'unassigned' ? { assigned_to: assignee } : {}), ...(status === 'resolved' ? { resolution_note: resolutionNote.trim() } : {}) },
    status === 'closed' ? 'Closure verified.' : status === 'resolved' ? 'Investigation resolved.' : status === 'open' ? 'Action reopened.' : 'Investigation started.',
  )

  const create = async () => {
    if (!client) return
    if (!createValues.title.trim() || !createValues.description.trim() || !createValues.departmentId || !createValues.assignedTo || !createValues.dueAt) {
      toast.error('Fill in every field first.')
      return
    }
    setPending(true)
    try {
      await createActionItem(client, {
        title: createValues.title.trim(), description: createValues.description.trim(),
        department_id: createValues.departmentId, assigned_to: createValues.assignedTo,
        due_at: new Date(createValues.dueAt).toISOString(), severity: createValues.severity,
      })
      toast.success('Manual clinical action created and assigned.')
      setCreateValues({ title: '', description: '', departmentId: '', assignedTo: '', dueAt: localDateTime(null), severity: 'medium' })
      await onCreated()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to create the action item.')
    } finally {
      setPending(false)
    }
  }

  const addComment = async () => {
    if (!client || !item || !comment.trim()) return
    setPending(true)
    try {
      await addActionItemComment(client, item.id, comment.trim())
      setComment('')
      toast.success('Note added.')
      await onChanged()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to add the investigation update.')
    } finally { setPending(false) }
  }

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!client || !item || !file) return
    setPending(true)
    try {
      await uploadActionItemEvidence(client, item.id, file)
      toast.success('Evidence uploaded.')
      await onChanged()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to upload evidence.')
    } finally {
      setPending(false)
      event.target.value = ''
    }
  }

  const severityTone = SEVERITY_TONE[(item?.severity ?? 'medium') as keyof typeof SEVERITY_TONE]

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-2xl overflow-y-auto bg-none bg-white px-5 py-6 text-[#000a1e] [&>button]:text-[#657180] sm:px-7">
        {creating ? (
          <div className="space-y-6">
            <div className="pr-10"><SheetTitle className="font-display text-xl text-[#000a1e]">New action</SheetTitle><SheetDescription className="sr-only">Create a clinical action with an owner and a deadline.</SheetDescription></div>
            <div className="space-y-4">
              <label className="block space-y-2"><Label>Title</Label><Input value={createValues.title} onChange={(event) => setCreateValues((value) => ({ ...value, title: event.target.value }))} placeholder="What needs to be looked at" /></label>
              <label className="block space-y-2"><Label>Details</Label><Textarea value={createValues.description} onChange={(event) => setCreateValues((value) => ({ ...value, description: event.target.value }))} placeholder="What happened, and what should be checked" /></label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2"><Label>Department</Label><Select value={createValues.departmentId} onValueChange={(departmentId) => setCreateValues((value) => ({ ...value, departmentId }))}><SelectTrigger aria-label="Manual action department"><SelectValue placeholder="Choose department" /></SelectTrigger><SelectContent>{departments.map((department) => <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>)}</SelectContent></Select></label>
                <label className="space-y-2"><Label>Owner</Label><Select value={createValues.assignedTo} onValueChange={(assignedTo) => setCreateValues((value) => ({ ...value, assignedTo }))}><SelectTrigger aria-label="Manual action owner"><SelectValue placeholder="Choose owner" /></SelectTrigger><SelectContent>{managers.map((manager) => <SelectItem key={manager.id} value={manager.id}>{manager.fullName}</SelectItem>)}</SelectContent></Select></label>
                <label className="space-y-2"><Label>Deadline</Label><Input type="datetime-local" value={createValues.dueAt} onChange={(event) => setCreateValues((value) => ({ ...value, dueAt: event.target.value }))} /></label>
                <label className="space-y-2"><Label>Severity</Label><Select value={createValues.severity} onValueChange={(value) => setCreateValues((state) => ({ ...state, severity: value as typeof state.severity }))}><SelectTrigger aria-label="Manual action severity"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select></label>
              </div>
            </div>
            <Button type="button" disabled={pending} onClick={() => void create()}>{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Create action</Button>
          </div>
        ) : item ? (
          <div className="space-y-5">
            {/* A panel that opens on a critical event should not open quietly.
                The header runs full-bleed and takes its temperature from the
                severity, so the seriousness registers before any reading. */}
            <header
              className={cn(
                '-mx-5 -mt-6 px-5 pb-5 pt-6 sm:-mx-7 sm:px-7',
                severityTone.wash,
              )}
            >
              <div className="flex flex-wrap items-center gap-2 pr-10">
                <span className={cn(PILL, STATUS_TONE[item.status].pill)}>
                  {STATUS_TONE[item.status].label}
                </span>
                <span className={cn(PILL, severityTone.pill)}>{severityTone.label}</span>
                {item.isOverdue ? (
                  <span className={cn(PILL, 'bg-[#ba1a1a] text-white')}>Overdue</span>
                ) : null}
              </div>
              <SheetTitle className="mt-3 pr-10 font-display text-[1.4rem] font-extrabold leading-tight tracking-[-0.03em] text-[#000a1e]">
                {item.title}
              </SheetTitle>
              <div className={cn('mt-3 mb-4', BRAND_RULE)} />
              {item.description ? (
                <ReportedSummary description={item.description} tone={severityTone} />
              ) : (
                <SheetDescription className="sr-only">No details added.</SheetDescription>
              )}
              {item.reportAssignmentId && item.reportingPeriodId ? (
                <Link
                  to={`/reports/${item.reportAssignmentId}/${item.reportingPeriodId}`}
                  className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#005db6] underline-offset-4 hover:underline"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Open the source report
                  <ExternalLink className="h-3 w-3" />
                </Link>
              ) : null}
            </header>

            {item.conditionState === 'corrected_pending_review' ? <div className="rounded-[0.35rem] border border-[#d9c3ee] bg-[#f7f0ff] px-4 py-3 text-sm leading-6 text-[#6b3fa0]"><strong>Corrected value is back within range.</strong> This stays open until someone confirms it.</div> : null}

            {item.source === 'critical_event' && (item.observedValue !== null || item.triggerThreshold !== null || item.fieldKey) ? <DetailSection title="What triggered this" icon={AlertTriangle}>
              <div className="flex flex-wrap gap-3">
                {item.observedValue !== null ? <div className="min-w-40 flex-1 rounded-[0.3rem] bg-[#edf4fb] px-3 py-3"><p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#526171]">Observed value</p><p className="mt-1 font-display text-lg font-bold text-[#000a1e]">{item.observedValue}</p></div> : null}
                {item.triggerThreshold !== null ? <div className="min-w-40 flex-1 rounded-[0.3rem] bg-[#fff3f3] px-3 py-3"><p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#8f1515]">Trigger rule</p><p className="mt-1 font-semibold text-[#8f1515]">{item.triggerOperator === 'gte' ? 'At least' : item.triggerOperator === 'eq' ? 'Exactly' : 'Greater than'} {item.triggerThreshold}</p></div> : null}
                {item.fieldKey ? <div className="min-w-40 flex-1 rounded-[0.3rem] bg-[#f3f6f9] px-3 py-3"><p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#526171]">Rule record</p><p className="mt-1 break-words font-mono text-xs text-[#1d3047]">{item.fieldKey}{item.ruleVersion ? ` · v${item.ruleVersion}` : ''}</p></div> : null}
              </div>
            </DetailSection> : null}

            <DetailSection title="Assignment" icon={ShieldCheck}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2"><Label>Owner</Label><Select value={assignee} onValueChange={setAssignee}><SelectTrigger aria-label="Action owner"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unassigned">Unassigned</SelectItem>{managers.map((manager) => <SelectItem key={manager.id} value={manager.id}>{manager.fullName}</SelectItem>)}</SelectContent></Select></label>
                <label className="space-y-2"><Label>Deadline</Label><Input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />{deadlineHint(item.dueAt, item.isOverdue) ? <span className={cn('block text-xs font-semibold', item.isOverdue ? 'text-[#ba1a1a]' : 'text-[#657180]')}>{deadlineHint(item.dueAt, item.isOverdue)}</span> : null}</label>
                <label className="space-y-2"><Label>Severity</Label><Select value={severity} onValueChange={(value) => setSeverity(value as typeof severity)}><SelectTrigger aria-label="Action severity"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select></label>
                <div className="flex items-end"><Button type="button" variant="secondary" disabled={pending} onClick={() => void mutate({ assigned_to: assignee === 'unassigned' ? null : assignee, severity, due_at: dueAt ? new Date(dueAt).toISOString() : null }, 'Assignment saved.')}><Save className="h-4 w-4" />Save</Button></div>
              </div>
            </DetailSection>

            <DetailSection title="Resolution" icon={CheckCircle2}>
              {item.status !== 'resolved' && item.status !== 'closed' ? <div className="space-y-3"><Label htmlFor="resolution-note">Resolution note</Label><Textarea id="resolution-note" rows={3} className="min-h-20" value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} placeholder="What was found, and what was done about it" /><div className="flex flex-wrap gap-2">{item.status !== 'in_progress' ? <Button type="button" variant="secondary" disabled={pending || assignee === 'unassigned'} onClick={() => void transition('in_progress')}>Start</Button> : null}<Button type="button" disabled={pending || !resolutionNote.trim()} onClick={() => void transition('resolved')}><CheckCircle2 className="h-4 w-4" />Resolve</Button></div></div> : item.status === 'resolved' ? <div className="space-y-3"><div className="rounded-[0.35rem] bg-[#edf7f0] px-4 py-3 text-sm leading-6 text-[#1f6b3b]"><strong>Resolution:</strong> {item.resolutionNote}</div><div className="flex flex-wrap gap-2"><Button type="button" disabled={pending} onClick={() => void transition('closed')}><ShieldCheck className="h-4 w-4" />Verify and close</Button><Button type="button" variant="secondary" disabled={pending} onClick={() => void transition('open')}><RotateCcw className="h-4 w-4" />Reopen</Button></div></div> : <div className="space-y-3"><p className="text-sm text-[#1f6b3b]">Verified by {item.verifiedByName ?? 'an administrator'}.</p><Button type="button" variant="secondary" disabled={pending} onClick={() => void transition('open')}><RotateCcw className="h-4 w-4" />Reopen</Button></div>}
            </DetailSection>

            <DetailSection title="Notes" icon={MessageSquareText}>
              <div className="space-y-3"><Textarea rows={2} className="min-h-16" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add a note" /><Button type="button" variant="secondary" disabled={pending || !comment.trim()} onClick={() => void addComment()}>Add note</Button>{item.comments?.map((entry) => <article key={entry.id} className="border-l-2 border-[#cfe0f4] pl-3"><p className="text-sm leading-6 text-[#1d3047]">{entry.body}</p><p className="mt-1 text-xs text-[#74777f]">{entry.authorName} · {entry.createdAt ? format(parseISO(entry.createdAt), 'MMM d, HH:mm') : 'recently'}</p></article>)}</div>
            </DetailSection>

            <DetailSection title="Evidence" icon={FileUp}>
              <div className="space-y-3"><label className="inline-flex cursor-pointer items-center gap-2 rounded-[0.25rem] border border-[#d4dde8] bg-white px-3 py-2 text-sm font-semibold text-[#1d3047] hover:bg-[#f3f6f9]"><FileUp className="h-4 w-4" />Upload<input type="file" className="sr-only" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.csv,.txt" onChange={(event) => void upload(event)} /></label><p className="text-xs text-[#74777f]">PDF, image, Office, CSV or text · max 10 MB</p>{item.evidence?.map((file) => <a key={file.id} href={file.downloadUrl} className="flex items-center justify-between gap-3 border-t border-[#e6ecf3] py-2 text-sm font-semibold text-[#005db6]"><span className="truncate">{file.originalName}</span><Download className="h-4 w-4 shrink-0" /></a>)}</div>
            </DetailSection>

            <DetailSection title="History" icon={History}>
              <ol className="space-y-4">{item.history?.map((entry) => <li key={entry.id} className="relative pl-5 before:absolute before:left-0 before:top-1.5 before:h-2 before:w-2 before:rounded-full before:bg-[#005db6]"><p className="text-sm font-semibold text-[#1d3047]">{readableEvent(entry.event)}</p>{entry.note ? <p className="mt-1 text-sm leading-6 text-[#657180]">{entry.note}</p> : null}<p className="mt-1 text-xs text-[#74777f]">{entry.changedByName} · {entry.createdAt ? format(parseISO(entry.createdAt), 'MMM d, yyyy HH:mm') : 'recently'}</p></li>)}</ol>
            </DetailSection>
          </div>
        ) : <div className="grid min-h-64 place-items-center"><SheetTitle className="sr-only">Loading clinical action</SheetTitle><SheetDescription className="sr-only">Loading the clinical action details and investigation history.</SheetDescription><Loader2 className="h-6 w-6 animate-spin text-[#005db6]" /></div>}
      </SheetContent>
    </Sheet>
  )
}
