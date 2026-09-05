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

function readableEvent(event: string) {
  const labels: Record<string, string> = {
    opened: 'Action opened', assigned: 'Owner assigned', status_changed: 'Status changed',
    investigation_started: 'Investigation started',
    resolved: 'Investigation resolved', verified: 'Closure verified', reopened: 'Action reopened',
    data_corrected: 'Reported value corrected', condition_recurred: 'Critical condition recurred',
    commented: 'Investigation update added', evidence_uploaded: 'Evidence uploaded', overdue: 'Deadline escalated',
  }
  return labels[event] ?? event.replaceAll('_', ' ')
}

function DetailSection({ title, icon: Icon, children }: { title: string; icon: typeof History; children: ReactNode }) {
  return (
    <section className="border-t border-[#dbe3ec] pt-5">
      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[#526171]"><Icon className="h-4 w-4 text-[#005db6]" />{title}</h3>
      <div className="mt-4">{children}</div>
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
      toast.error('Add a title, investigation context, department, owner, and deadline.')
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
      toast.success('Investigation update added.')
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
      toast.success('Evidence uploaded securely.')
      await onChanged()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to upload evidence.')
    } finally {
      setPending(false)
      event.target.value = ''
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-2xl overflow-y-auto bg-none bg-white px-5 py-6 text-[#000a1e] [&>button]:text-[#657180] sm:px-7">
        {creating ? (
          <div className="space-y-6">
            <div className="pr-10"><SheetTitle className="font-display text-xl text-[#000a1e]">Create manual clinical action</SheetTitle><SheetDescription className="mt-2 text-[#657180]">Give the follow-up a clear owner and deadline from the beginning.</SheetDescription></div>
            <div className="space-y-4">
              <label className="block space-y-2"><Label>Action title</Label><Input value={createValues.title} onChange={(event) => setCreateValues((value) => ({ ...value, title: event.target.value }))} placeholder="What must be investigated?" /></label>
              <label className="block space-y-2"><Label>Investigation context</Label><Textarea value={createValues.description} onChange={(event) => setCreateValues((value) => ({ ...value, description: event.target.value }))} placeholder="Explain the signal, expected follow-up, and evidence needed." /></label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2"><Label>Department</Label><Select value={createValues.departmentId} onValueChange={(departmentId) => setCreateValues((value) => ({ ...value, departmentId }))}><SelectTrigger aria-label="Manual action department"><SelectValue placeholder="Choose department" /></SelectTrigger><SelectContent>{departments.map((department) => <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>)}</SelectContent></Select></label>
                <label className="space-y-2"><Label>Responsible owner</Label><Select value={createValues.assignedTo} onValueChange={(assignedTo) => setCreateValues((value) => ({ ...value, assignedTo }))}><SelectTrigger aria-label="Manual action owner"><SelectValue placeholder="Choose owner" /></SelectTrigger><SelectContent>{managers.map((manager) => <SelectItem key={manager.id} value={manager.id}>{manager.fullName}</SelectItem>)}</SelectContent></Select></label>
                <label className="space-y-2"><Label>Deadline</Label><Input type="datetime-local" value={createValues.dueAt} onChange={(event) => setCreateValues((value) => ({ ...value, dueAt: event.target.value }))} /></label>
                <label className="space-y-2"><Label>Severity</Label><Select value={createValues.severity} onValueChange={(value) => setCreateValues((state) => ({ ...state, severity: value as typeof state.severity }))}><SelectTrigger aria-label="Manual action severity"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select></label>
              </div>
            </div>
            <Button type="button" disabled={pending} onClick={() => void create()}>{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Create and assign</Button>
          </div>
        ) : item ? (
          <div className="space-y-6">
            <div className="pr-10">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em]"><span className={cn('rounded-full px-2.5 py-1', item.isOverdue ? 'bg-[#fdecec] text-[#ba1a1a]' : 'bg-[#edf4fb] text-[#005db6]')}>{item.isOverdue ? 'Overdue' : item.status.replace('_', ' ')}</span><span className="text-[#657180]">{item.severity} severity</span></div>
              <SheetTitle className="mt-3 font-display text-xl leading-tight text-[#000a1e]">{item.title}</SheetTitle>
              <SheetDescription className="mt-2 leading-6 text-[#657180]">{item.description ?? 'No investigation context has been added.'}</SheetDescription>
            </div>

            {item.conditionState === 'corrected_pending_review' ? <div className="rounded-[0.35rem] border border-[#d9c3ee] bg-[#f7f0ff] px-4 py-3 text-sm leading-6 text-[#6b3fa0]"><strong>Data correction needs verification.</strong> The reported value is now below the rule threshold, but the follow-up remains open until a person confirms the correction.</div> : null}

            {item.reportAssignmentId && item.reportingPeriodId ? <Button asChild variant="secondary"><Link to={`/reports/${item.reportAssignmentId}/${item.reportingPeriodId}`}><FileText className="h-4 w-4" />Open source report<ExternalLink className="h-3.5 w-3.5" /></Link></Button> : null}

            {item.source === 'critical_event' && (item.observedValue !== null || item.triggerThreshold !== null || item.fieldKey) ? <DetailSection title="Why this became critical" icon={AlertTriangle}>
              <div className="flex flex-wrap gap-3">
                {item.observedValue !== null ? <div className="min-w-40 flex-1 rounded-[0.3rem] bg-[#edf4fb] px-3 py-3"><p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#526171]">Observed value</p><p className="mt-1 font-display text-lg font-bold text-[#000a1e]">{item.observedValue}</p></div> : null}
                {item.triggerThreshold !== null ? <div className="min-w-40 flex-1 rounded-[0.3rem] bg-[#fff3f3] px-3 py-3"><p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#8f1515]">Trigger rule</p><p className="mt-1 font-semibold text-[#8f1515]">{item.triggerOperator === 'gte' ? 'At least' : item.triggerOperator === 'eq' ? 'Exactly' : 'Greater than'} {item.triggerThreshold}</p></div> : null}
                {item.fieldKey ? <div className="min-w-40 flex-1 rounded-[0.3rem] bg-[#f3f6f9] px-3 py-3"><p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#526171]">Rule record</p><p className="mt-1 break-words font-mono text-xs text-[#1d3047]">{item.fieldKey}{item.ruleVersion ? ` · v${item.ruleVersion}` : ''}</p></div> : null}
              </div>
            </DetailSection> : null}

            <DetailSection title="Ownership and deadline" icon={ShieldCheck}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2"><Label>Responsible owner</Label><Select value={assignee} onValueChange={setAssignee}><SelectTrigger aria-label="Action owner"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unassigned">Unassigned</SelectItem>{managers.map((manager) => <SelectItem key={manager.id} value={manager.id}>{manager.fullName}</SelectItem>)}</SelectContent></Select></label>
                <label className="space-y-2"><Label>Deadline</Label><Input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
                <label className="space-y-2"><Label>Severity</Label><Select value={severity} onValueChange={(value) => setSeverity(value as typeof severity)}><SelectTrigger aria-label="Action severity"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select></label>
                <div className="flex items-end"><Button type="button" variant="secondary" disabled={pending} onClick={() => void mutate({ assigned_to: assignee === 'unassigned' ? null : assignee, severity, due_at: dueAt ? new Date(dueAt).toISOString() : null }, 'Ownership and deadline saved.')}><Save className="h-4 w-4" />Save details</Button></div>
              </div>
            </DetailSection>

            <DetailSection title="Investigation decision" icon={CheckCircle2}>
              {item.status !== 'resolved' && item.status !== 'closed' ? <div className="space-y-3"><Label htmlFor="resolution-note">Resolution note</Label><Textarea id="resolution-note" value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} placeholder="Document what was reviewed, the finding, corrective action, and remaining risk." /><div className="flex flex-wrap gap-2">{item.status !== 'in_progress' ? <Button type="button" variant="secondary" disabled={pending || assignee === 'unassigned'} onClick={() => void transition('in_progress')}>Start investigation</Button> : null}<Button type="button" disabled={pending || !resolutionNote.trim()} onClick={() => void transition('resolved')}><CheckCircle2 className="h-4 w-4" />Resolve with note</Button></div></div> : item.status === 'resolved' ? <div className="space-y-3"><div className="rounded-[0.35rem] bg-[#edf7f0] px-4 py-3 text-sm leading-6 text-[#1f6b3b]"><strong>Resolution:</strong> {item.resolutionNote}</div><div className="flex flex-wrap gap-2"><Button type="button" disabled={pending} onClick={() => void transition('closed')}><ShieldCheck className="h-4 w-4" />Verify and close</Button><Button type="button" variant="secondary" disabled={pending} onClick={() => void transition('open')}><RotateCcw className="h-4 w-4" />Reopen</Button></div></div> : <div className="space-y-3"><p className="text-sm text-[#1f6b3b]">Closure verified by {item.verifiedByName ?? 'an administrator'}.</p><Button type="button" variant="secondary" disabled={pending} onClick={() => void transition('open')}><RotateCcw className="h-4 w-4" />Reopen with history preserved</Button></div>}
            </DetailSection>

            <DetailSection title="Investigation updates" icon={MessageSquareText}>
              <div className="space-y-3"><Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add a progress note, decision, or handover..." /><Button type="button" variant="secondary" disabled={pending || !comment.trim()} onClick={() => void addComment()}>Add update</Button>{item.comments?.map((entry) => <article key={entry.id} className="border-l-2 border-[#cfe0f4] pl-3"><p className="text-sm leading-6 text-[#1d3047]">{entry.body}</p><p className="mt-1 text-xs text-[#74777f]">{entry.authorName} · {entry.createdAt ? format(parseISO(entry.createdAt), 'MMM d, HH:mm') : 'recently'}</p></article>)}</div>
            </DetailSection>

            <DetailSection title="Evidence" icon={FileUp}>
              <div className="space-y-3"><label className="inline-flex cursor-pointer items-center gap-2 rounded-[0.25rem] border border-[#d4dde8] bg-white px-3 py-2 text-sm font-semibold text-[#1d3047] hover:bg-[#f3f6f9]"><FileUp className="h-4 w-4" />Upload evidence<input type="file" className="sr-only" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.csv,.txt" onChange={(event) => void upload(event)} /></label><p className="text-xs text-[#74777f]">Private storage · PDF, image, Office, CSV, or text · maximum 10 MB</p>{item.evidence?.map((file) => <a key={file.id} href={file.downloadUrl} className="flex items-center justify-between gap-3 border-t border-[#e6ecf3] py-2 text-sm font-semibold text-[#005db6]"><span className="truncate">{file.originalName}</span><Download className="h-4 w-4 shrink-0" /></a>)}</div>
            </DetailSection>

            <DetailSection title="Permanent history" icon={History}>
              <ol className="space-y-4">{item.history?.map((entry) => <li key={entry.id} className="relative pl-5 before:absolute before:left-0 before:top-1.5 before:h-2 before:w-2 before:rounded-full before:bg-[#005db6]"><p className="text-sm font-semibold text-[#1d3047]">{readableEvent(entry.event)}</p>{entry.note ? <p className="mt-1 text-sm leading-6 text-[#657180]">{entry.note}</p> : null}<p className="mt-1 text-xs text-[#74777f]">{entry.changedByName} · {entry.createdAt ? format(parseISO(entry.createdAt), 'MMM d, yyyy HH:mm') : 'recently'}</p></li>)}</ol>
            </DetailSection>
          </div>
        ) : <div className="grid min-h-64 place-items-center"><SheetTitle className="sr-only">Loading clinical action</SheetTitle><SheetDescription className="sr-only">Loading the clinical action details and investigation history.</SheetDescription><Loader2 className="h-6 w-6 animate-spin text-[#005db6]" /></div>}
      </SheetContent>
    </Sheet>
  )
}
