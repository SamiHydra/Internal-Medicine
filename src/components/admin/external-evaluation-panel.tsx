import { useEffect, useMemo, useState } from 'react'
import { FileInput, Loader2, Send, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  const metCount = Object.values(indicators).filter(Boolean).length
  const indicatorCount = Object.keys(indicators).length

  return (
    <section className={panelClass}>
      <SectionHeader
        eyebrow="External evaluation"
        title="Record a paper evaluation"
        actions={
          <Button variant="ghost" size="icon" aria-label="Close" onClick={() => setIsOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        }
      />

      {/* Every field is labelled. A placeholder disappears the moment a value
          is chosen, which left this form unreadable exactly when it was full. */}
      <div className="mt-5 grid gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="space-y-1.5">
          <Label>Resident</Label>
          <Select value={subjectId} onValueChange={setSubjectId}>
            <SelectTrigger aria-label="Resident evaluated">
              <SelectValue placeholder="Choose a resident" />
            </SelectTrigger>
            <SelectContent>
              {residents.map((resident) => (
                <SelectItem key={resident.id} value={resident.id}>
                  {resident.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1.5">
          <Label>Rotation</Label>
          <Select value={placement} onValueChange={setPlacement}>
            <SelectTrigger aria-label="External rotation">
              <SelectValue placeholder="Choose a rotation" />
            </SelectTrigger>
            <SelectContent>
              {EXTERNAL_PLACEMENT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1.5">
          <Label>Date on the form</Label>
          <Input
            type="date"
            max={today}
            value={evaluationDate}
            aria-label="Evaluation date"
            onChange={(event) => setEvaluationDate(event.target.value || today)}
          />
        </label>
        <label className="space-y-1.5">
          <Label>Evaluator</Label>
          <Input
            value={evaluatorName}
            aria-label="Evaluator name"
            placeholder="Name on the sheet"
            onChange={(event) => setEvaluatorName(event.target.value)}
          />
        </label>
        <label className="space-y-1.5">
          <Label>
            Their department <span className="font-normal text-[#9aa6b5]">optional</span>
          </Label>
          <Input
            value={evaluatorDepartment}
            aria-label="Evaluator department"
            placeholder="e.g. ICU"
            onChange={(event) => setEvaluatorDepartment(event.target.value)}
          />
        </label>
        <label className="space-y-1.5">
          <Label>Overall rating</Label>
          <Select value={overallRating} onValueChange={setOverallRating}>
            <SelectTrigger aria-label="Overall rating">
              <SelectValue placeholder="Choose a rating" />
            </SelectTrigger>
            <SelectContent>
              {OVERALL_RATING_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      {/* Eleven bordered boxes each holding one switch was more chrome than
          content. A switch also reads as a setting; these are ticks copied off
          a sheet, so they are checkboxes in one quiet card. */}
      <div className="mt-6">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#526171]">
            Indicators met
          </p>
          <p className="text-[13px] font-semibold tabular-nums text-[#005db6]">
            {metCount} of {indicatorCount}
          </p>
        </div>
        <div className="mt-2 divide-y divide-[#eef2f6] rounded-[0.35rem] border border-[#e6ecf3]">
          {RESIDENT_COMPETENCIES.map((group) => (
            <div key={group.group} className="px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8b9199]">
                {group.group}
              </p>
              <div className="mt-1 grid sm:grid-cols-2">
                {group.items.map((item) => {
                  const checked = indicators[item.name]

                  return (
                    <label
                      key={item.name}
                      className={cn(
                        'flex cursor-pointer items-center gap-2.5 rounded-[0.25rem] px-2 py-1.5 transition-colors hover:bg-[#f7f9fc]',
                        checked && 'text-[#000a1e]',
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) =>
                          setIndicators((prev) => ({ ...prev, [item.name]: value === true }))
                        }
                      />
                      <span
                        className={cn(
                          'text-[13px] leading-5',
                          checked ? 'font-medium text-[#000a1e]' : 'text-[#52606d]',
                        )}
                      >
                        {item.label}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <label className="mt-5 block space-y-1.5">
        <Label>
          Comment <span className="font-normal text-[#9aa6b5]">optional</span>
        </Label>
        <Textarea
          value={comment}
          aria-label="Comment"
          placeholder="Anything written on the sheet"
          className="min-h-20"
          onChange={(event) => setComment(event.target.value)}
        />
      </label>

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
