import { useEffect, useMemo, useState } from 'react'
import { FileInput, Loader2, Send, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { SectionHeader, panelClass } from '@/components/dashboard/section-panel'
import { useAppData } from '@/context/app-data-context'
import {
  EXTERNAL_PLACEMENT_OPTIONS,
  submitExternalEvaluation,
} from '@/lib/api/academic'
import { getApiBrowserClient } from '@/lib/api/client'
import {
  OVERALL_RATING_OPTIONS,
  RESIDENT_COMPETENCIES,
} from '@/config/academic-evaluation-fields'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '@/lib/api/helpers'

const today = new Date().toISOString().slice(0, 10)

type IndicatorState = Record<string, boolean>

const emptyIndicators: IndicatorState = Object.fromEntries(
  RESIDENT_COMPETENCIES.flatMap((group) => group.items.map((item) => [item.name, false])),
)

/**
 * Admin entry of an externally-sourced paper evaluation (V2 Phase 3): host
 * departments (ICU, Emergency, external hospitals, ...) evaluate rotating
 * residents on paper; an administrator records the sheet here. No author
 * account exists; the evaluator's name and department are stored verbatim.
 */
export function ExternalEvaluationPanel({ onRecorded }: { onRecorded: () => void }) {
  const client = getApiBrowserClient()
  const { state, ensureProfileDirectoryData } = useAppData()

  const [isOpen, setIsOpen] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [subjectId, setSubjectId] = useState('')
  const [evaluationDate, setEvaluationDate] = useState(today)
  const [placement, setPlacement] = useState('')
  const [evaluatorName, setEvaluatorName] = useState('')
  const [evaluatorDepartment, setEvaluatorDepartment] = useState('')
  const [indicators, setIndicators] = useState<IndicatorState>(emptyIndicators)
  const [overallRating, setOverallRating] = useState('')
  const [comment, setComment] = useState('')

  useEffect(() => {
    if (isOpen) {
      void ensureProfileDirectoryData()
    }
  }, [isOpen, ensureProfileDirectoryData])

  const residents = useMemo(
    () =>
      state.profiles
        .filter((profile) => profile.role === 'resident' && profile.active)
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [state.profiles],
  )

  const reset = () => {
    setSubjectId('')
    setPlacement('')
    setEvaluatorName('')
    setEvaluatorDepartment('')
    setIndicators(emptyIndicators)
    setOverallRating('')
    setComment('')
    setEvaluationDate(today)
  }

  const submit = async () => {
    if (!client || !subjectId || !placement || !evaluatorName.trim() || !overallRating) {
      return
    }

    setIsBusy(true)
    try {
      await submitExternalEvaluation(client, {
        subjectId,
        evaluationDate,
        placement,
        evaluatorName: evaluatorName.trim(),
        evaluatorDepartment: evaluatorDepartment.trim() || null,
        onTime: indicators.onTime,
        prepared: indicators.prepared,
        presentationClear: indicators.presentationClear,
        clinicalReasoning: indicators.clinicalReasoning,
        managementPlan: indicators.managementPlan,
        documentationTimely: indicators.documentationTimely,
        communication: indicators.communication,
        professional: indicators.professional,
        responsiveFeedback: indicators.responsiveFeedback,
        followThrough: indicators.followThrough,
        overallRating: Number(overallRating),
        comment: comment.trim() || null,
      })
      toast.success('External evaluation recorded.')
      reset()
      setIsOpen(false)
      onRecorded()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to record the external evaluation.'))
    } finally {
      setIsBusy(false)
    }
  }

  if (!isOpen) {
    return (
      <div className="flex justify-end">
        <Button variant="secondary" onClick={() => setIsOpen(true)}>
          <FileInput className="mr-1.5 h-4 w-4" />
          Enter external evaluation
        </Button>
      </div>
    )
  }

  const canSubmit = Boolean(subjectId && placement && evaluatorName.trim() && overallRating)

  return (
    <section className={panelClass}>
      <SectionHeader
        eyebrow="External evaluation"
        title="Record a paper evaluation"
        description="For residents rotating in ICU, Emergency, the external hospitals, Dermatology, Radiology, or Psychiatry: the host department evaluated on paper, and you are recording that sheet. The evaluator has no account here."
        actions={
          <Button variant="ghost" size="icon" aria-label="Close" onClick={() => setIsOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        }
      />

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Select value={subjectId} onValueChange={setSubjectId}>
          <SelectTrigger aria-label="Resident evaluated">
            <SelectValue placeholder="Resident evaluated" />
          </SelectTrigger>
          <SelectContent>
            {residents.map((resident) => (
              <SelectItem key={resident.id} value={resident.id}>
                {resident.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          max={today}
          value={evaluationDate}
          aria-label="Evaluation date"
          onChange={(event) => setEvaluationDate(event.target.value || today)}
        />
        <Select value={placement} onValueChange={setPlacement}>
          <SelectTrigger aria-label="External rotation">
            <SelectValue placeholder="External rotation" />
          </SelectTrigger>
          <SelectContent>
            {EXTERNAL_PLACEMENT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={evaluatorName}
          aria-label="Evaluator name"
          placeholder="Evaluator name (required)"
          onChange={(event) => setEvaluatorName(event.target.value)}
        />
        <Input
          value={evaluatorDepartment}
          aria-label="Evaluator department"
          placeholder="Evaluator department (optional)"
          onChange={(event) => setEvaluatorDepartment(event.target.value)}
        />
        <Select value={overallRating} onValueChange={setOverallRating}>
          <SelectTrigger aria-label="Overall rating">
            <SelectValue placeholder="Overall rating" />
          </SelectTrigger>
          <SelectContent>
            {OVERALL_RATING_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-6 space-y-5">
        {RESIDENT_COMPETENCIES.map((group) => (
          <div key={group.group} className="space-y-2.5">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#74777f]">
              {group.group}
            </p>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {group.items.map((item) => {
                const checked = indicators[item.name]
                return (
                  <label
                    key={item.name}
                    className={cn(
                      'flex cursor-pointer items-center justify-between gap-4 rounded-[0.25rem] border bg-white px-4 py-2.5 transition',
                      checked ? 'border-[#005db6] bg-[#eef5ff]' : 'border-[#d4dde8] hover:bg-[#f6f8fa]',
                    )}
                  >
                    <span className="text-sm font-medium text-[#000a1e]">{item.label}</span>
                    <Switch
                      checked={checked}
                      onCheckedChange={(value) =>
                        setIndicators((prev) => ({ ...prev, [item.name]: value }))
                      }
                    />
                  </label>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5">
        <Textarea
          value={comment}
          aria-label="Comment"
          placeholder="Comment from the paper form (optional)"
          className="min-h-20"
          onChange={(event) => setComment(event.target.value)}
        />
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => setIsOpen(false)} disabled={isBusy}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={!canSubmit || isBusy}>
          {isBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
          Record evaluation
        </Button>
      </div>
    </section>
  )
}
