import { Check, Minus } from 'lucide-react'
import type { ReactNode } from 'react'

import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import {
  CONCERN_OPTIONS,
  CONSULTANT_SCORE_ITEMS,
  MDT_PARTICIPANT_OPTIONS,
  RESIDENT_COMPETENCIES,
  SYSTEM_ISSUE_OPTIONS,
  optionLabels,
  overallRatingDescriptor,
} from '@/config/academic-evaluation-fields'
import type {
  AcademicEvaluationRecord,
  ConsultantEvaluationRecord,
  ExtraEvaluationAnswer,
  ResidentEvaluationRecord,
} from '@/lib/api/types'
import { cn } from '@/lib/utils'

function isConsultantRecord(
  record: AcademicEvaluationRecord,
): record is ConsultantEvaluationRecord {
  return 'qualityScore' in record
}

function formatDate(value: string | null): string {
  if (!value) {
    return '-'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function initialsFor(fullName: string | null): string {
  return (
    (fullName ?? '')
      .split(' ')
      .map((part) => part[0])
      .filter(Boolean)
      .join('')
      .slice(0, 2)
      .toUpperCase() || '-'
  )
}

function scoreBand(value: number): { pct: number; hex: string; text: string; word: string } {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  if (pct >= 80) {
    return { pct, hex: '#34d399', text: 'text-emerald-300', word: 'Strong' }
  }
  if (pct >= 50) {
    return { pct, hex: '#fbbf24', text: 'text-amber-300', word: 'Fair' }
  }
  return { pct, hex: '#fb7185', text: 'text-rose-300', word: 'Needs work' }
}

const eyebrowClass = 'text-xs font-bold uppercase tracking-[0.16em] text-amber-300/90'

function Section({
  label,
  meta,
  children,
}: {
  label: string
  meta?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-4 border-t border-white/10 pt-6">
      <div className="flex items-center justify-between gap-3">
        <p className={eyebrowClass}>{label}</p>
        {meta ? (
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-white/55">
            {meta}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  )
}

function MetaRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-[13px] text-white/55">{label}</dt>
      <dd className="text-right text-[13px] font-medium text-white">{value}</dd>
    </div>
  )
}

function IndicatorRow({ label, met }: { label: string; met: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
          met ? 'bg-emerald-400/15 text-emerald-300' : 'bg-white/5 text-white/30',
        )}
      >
        {met ? <Check className="h-3.5 w-3.5" /> : <Minus className="h-3 w-3" />}
      </span>
      <span className={cn('text-sm', met ? 'text-white/90' : 'text-white/45')}>{label}</span>
    </div>
  )
}

function ChipList({ labels, empty }: { labels: string[]; empty: string }) {
  if (labels.length === 0) {
    return <p className="text-sm text-white/40">{empty}</p>
  }
  return (
    <div className="flex flex-wrap gap-2.5">
      {labels.map((label) => (
        <span
          key={label}
          className="rounded-md bg-white/10 px-2.5 py-1 text-[13px] font-medium text-white/90"
        >
          {label}
        </span>
      ))}
    </div>
  )
}

function formatExtraValue(value: unknown): ReactNode {
  if (value === null || value === undefined || value === '') {
    return '-'
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : '-'
  }
  return String(value)
}

/** Answers to admin-added form fields (beyond the built-in v1 layout). */
function ExtraAnswersSection({ extras }: { extras?: ExtraEvaluationAnswer[] }) {
  if (!extras || extras.length === 0) {
    return null
  }
  return (
    <Section label="Additional fields">
      <dl className="divide-y divide-white/10">
        {extras.map((extra) => (
          <MetaRow key={extra.key} label={extra.label} value={formatExtraValue(extra.value)} />
        ))}
      </dl>
    </Section>
  )
}

function CommentBlock({ comment }: { comment: string | null }) {
  if (!comment) {
    return <p className="text-sm text-white/40">No comment left.</p>
  }
  return (
    <p className="whitespace-pre-wrap rounded-lg bg-white/5 px-3.5 py-3 text-sm leading-6 text-white/85">
      {comment}
    </p>
  )
}

/** Bold score with a width-filling progress bar, color-banded for a quick read. */
function ScoreHeader({ value, label }: { value: number; label: string }) {
  const band = scoreBand(value)
  return (
    <div className="mt-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/55">{label}</p>
          <p className="mt-1.5 font-display text-[2.4rem] font-bold leading-none text-white">
            {band.pct}
            <span className="ml-0.5 text-xl font-semibold text-white/45">%</span>
          </p>
        </div>
        <span className={cn('mb-1 text-sm font-semibold', band.text)}>{band.word}</span>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full"
          style={{ width: `${band.pct}%`, backgroundColor: band.hex }}
        />
      </div>
    </div>
  )
}

function ConsultantDetail({ record }: { record: ConsultantEvaluationRecord }) {
  const metCount = CONSULTANT_SCORE_ITEMS.filter((item) => record[item.name]).length
  const descriptor = overallRatingDescriptor(record.overallRating)
  return (
    <>
      <Section label="Round details">
        <dl className="divide-y divide-white/10">
          <MetaRow label="Evaluation date" value={formatDate(record.evaluationDate)} />
          <MetaRow label="Ward" value={record.wardName ?? '-'} />
          <MetaRow label="Evaluator" value={record.authorName ?? '-'} />
          <MetaRow label="Senior present" value={record.seniorPresent ? 'Yes' : 'No'} />
          {record.seniorJoinedAt ? (
            <MetaRow label="Senior joined" value={record.seniorJoinedAt} />
          ) : null}
          {record.presenceMinutes != null ? (
            <MetaRow label="Presence" value={`${record.presenceMinutes} min`} />
          ) : null}
          {record.pctPatientsSeen != null ? (
            <MetaRow label="Patients seen" value={`${record.pctPatientsSeen}%`} />
          ) : null}
          <MetaRow label="Round delayed" value={record.roundDelayed ? 'Yes' : 'No'} />
          <MetaRow
            label="Overall rating"
            value={
              record.overallRating != null
                ? `${record.overallRating} / 5${descriptor ? ` · ${descriptor}` : ''}`
                : '-'
            }
          />
        </dl>
      </Section>

      <Section
        label="Quality indicators"
        meta={`${metCount}/${CONSULTANT_SCORE_ITEMS.length} met`}
      >
        <div className="space-y-3.5">
          {CONSULTANT_SCORE_ITEMS.map((item) => (
            <IndicatorRow key={item.name} label={item.label} met={Boolean(record[item.name])} />
          ))}
        </div>
      </Section>

      <Section label="MDT participants">
        <ChipList
          labels={optionLabels(MDT_PARTICIPANT_OPTIONS, record.mdtParticipants)}
          empty="None recorded."
        />
      </Section>

      <Section label="System issues">
        <ChipList
          labels={optionLabels(SYSTEM_ISSUE_OPTIONS, record.systemIssues)}
          empty="None flagged."
        />
      </Section>

      <ExtraAnswersSection extras={record.extraAnswers} />

      <Section label="Comment">
        <CommentBlock comment={record.comment} />
      </Section>
    </>
  )
}

function ResidentDetail({ record }: { record: ResidentEvaluationRecord }) {
  const descriptor = overallRatingDescriptor(record.overallRating)
  return (
    <>
      <Section label="Round details">
        <dl className="divide-y divide-white/10">
          <MetaRow label="Evaluation date" value={formatDate(record.evaluationDate)} />
          <MetaRow label="Ward" value={record.wardName ?? '-'} />
          <MetaRow label="Evaluator" value={record.authorName ?? '-'} />
          <MetaRow
            label="Overall rating"
            value={
              record.overallRating != null
                ? `${record.overallRating} / 5${descriptor ? ` · ${descriptor}` : ''}`
                : '-'
            }
          />
        </dl>
      </Section>

      <Section label="Performance">
        <div className="space-y-5">
          {RESIDENT_COMPETENCIES.map((competency) => (
            <div key={competency.group} className="space-y-2.5">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/55">
                {competency.group}
              </p>
              {competency.items.map((item) => (
                <IndicatorRow
                  key={item.name}
                  label={item.label}
                  met={Boolean(record[item.name])}
                />
              ))}
            </div>
          ))}
        </div>
      </Section>

      <Section label="Concerns">
        <ChipList
          labels={optionLabels(CONCERN_OPTIONS, record.concerns)}
          empty="None flagged."
        />
      </Section>

      <ExtraAnswersSection extras={record.extraAnswers} />

      <Section label="Comment">
        <CommentBlock comment={record.comment} />
      </Section>
    </>
  )
}

export function AcademicEvaluationDetailSheet({
  record,
  open,
  onOpenChange,
}: {
  record: AcademicEvaluationRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const consultant = record ? isConsultantRecord(record) : false
  const score = record ? (isConsultantRecord(record) ? record.qualityScore : record.performanceScore) : 0

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="max-w-md p-0">
        <div
          role="region"
          aria-label="Evaluation details"
          tabIndex={0}
          className="scrollbar-on-dark flex h-full flex-col overflow-y-auto px-6 pb-8 pt-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#f0b429]"
        >
          {record ? (
            <>
              <div className="pr-9">
                <p className={eyebrowClass}>
                  {consultant ? 'Consultant evaluation' : 'Resident evaluation'}
                </p>
                <div className="mt-3 flex items-center gap-3.5">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-amber-200 ring-1 ring-white/15">
                    {initialsFor(record.subjectName)}
                  </span>
                  <div className="min-w-0">
                    <SheetTitle className="text-[1.3rem] leading-tight">
                      {record.subjectName ?? 'Evaluation'}
                    </SheetTitle>
                    <SheetDescription className="mt-0.5 text-white/60">
                      {formatDate(record.evaluationDate)}
                      {record.wardName ? ` · ${record.wardName}` : ''}
                    </SheetDescription>
                  </div>
                </div>
                <ScoreHeader value={score} label={consultant ? 'Round quality' : 'Performance'} />
              </div>

              <div className="mt-7 space-y-6">
                {isConsultantRecord(record) ? (
                  <ConsultantDetail record={record} />
                ) : (
                  <ResidentDetail record={record as ResidentEvaluationRecord} />
                )}
              </div>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
