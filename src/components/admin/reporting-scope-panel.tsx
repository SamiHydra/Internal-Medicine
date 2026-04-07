import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

type ScopeOption = {
  label: string
  value: string
}

type ScopeField = {
  label: string
  options: readonly ScopeOption[]
  placeholder: string
  value: string
  onValueChange: (value: string) => void
  triggerClassName?: string
}

type ScopeMetricTone = 'blue' | 'gold' | 'navy' | 'neutral'

type ScopeMetric = {
  label: string
  value: string
  note?: string
  tone?: ScopeMetricTone
}

const metricToneClasses: Record<ScopeMetricTone, string> = {
  blue: 'bg-[#edf4fb] text-[#00468c] outline-[#cfe0f4]/75',
  gold: 'bg-[#fcf5e8] text-[#8a5a00] outline-[#edd9b0]/75',
  navy: 'bg-[#edf1f5] text-[#1d3047] outline-[#d4dde8]/75',
  neutral: 'bg-[#f6f8fa] text-[#1d3047] outline-[#d9e0e7]/75',
}

export function ReportingScopePanel({
  fields,
  metrics = [],
  fieldsClassName,
  className,
}: {
  fields: readonly ScopeField[]
  metrics?: readonly ScopeMetric[]
  fieldsClassName?: string
  className?: string
}) {
  return (
    <section
      className={cn(
        'rounded-[0.35rem] bg-[#f8fafc] p-4 outline outline-1 outline-[#d9e0e7]/75',
        className,
      )}
    >
      <div
        className={cn(
          'grid gap-3',
          fields.length <= 1
            ? 'grid-cols-1'
            : fields.length === 2
              ? 'md:grid-cols-2'
              : 'sm:[grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]',
          fieldsClassName,
        )}
      >
        {fields.map((field) => (
          <div key={field.label} className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#74777f]">
              {field.label}
            </p>
            <Select value={field.value} onValueChange={field.onValueChange}>
              <SelectTrigger
                className={cn(
                  'mt-2 h-10 min-w-0 rounded-[0.25rem] border-[#d9e0e7] bg-[#ffffff] px-3.5 text-left text-[#000a1e] shadow-none focus:ring-0 hover:border-[#c9d4e2]',
                  field.triggerClassName,
                )}
              >
                <SelectValue
                  placeholder={field.placeholder}
                  className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
                />
              </SelectTrigger>
              <SelectContent side="bottom" align="start" sideOffset={10}>
                {field.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      {metrics.length ? (
        <div
          className={cn(
            'mt-4 grid gap-3 border-t border-[#d9e0e7] pt-4',
            metrics.length === 1
              ? 'grid-cols-1'
              : metrics.length === 2
                ? 'md:grid-cols-2'
                : 'md:grid-cols-2',
          )}
        >
          {metrics.map((metric) => {
            const tone = metric.tone ?? 'neutral'

            return (
              <div
                key={metric.label}
                className={cn(
                  'min-w-0 rounded-[0.3rem] px-3.5 py-3 outline outline-1',
                  metricToneClasses[tone],
                )}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em]">
                  {metric.label}
                </p>
                <p className="mt-2 break-words font-display text-[1.65rem] leading-[1.02]">{metric.value}</p>
                {metric.note ? (
                  <p className="mt-1 text-xs leading-5 text-current/75">{metric.note}</p>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
