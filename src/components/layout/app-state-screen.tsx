import { AlertTriangle, ShieldCheck, Wrench } from 'lucide-react'

import stPaulosLogo from '@/assets/StPaulosLogoColor.jpg'
import { FullPageSkeleton } from '@/components/layout/loading-skeletons'

type ScreenTone = 'loading' | 'setup' | 'error' | 'info'

/** Per-state colors. `accent` drives the top bar + icon; `label` tints the eyebrow. */
const TONE_CONFIG: Record<ScreenTone, { accent: string; label: string }> = {
  loading: { accent: '#005db6', label: '#005db6' },
  setup: { accent: '#f0b429', label: '#9a6b00' },
  error: { accent: '#ba1a1a', label: '#ba1a1a' },
  info: { accent: '#002147', label: '#005db6' },
}

function resolveScreenTone(title: string): ScreenTone {
  const normalizedTitle = title.toLowerCase()

  if (normalizedTitle.includes('loading')) {
    return 'loading'
  }

  if (normalizedTitle.includes('required') || normalizedTitle.includes('configuration')) {
    return 'setup'
  }

  if (normalizedTitle.includes('unable') || normalizedTitle.includes('error')) {
    return 'error'
  }

  return 'info'
}

export function AppStateScreen({
  title,
  description,
  detail,
}: {
  title: string
  description: string
  detail?: string | null
}) {
  const tone = resolveScreenTone(title)

  if (tone === 'loading') {
    return <FullPageSkeleton label={title} />
  }

  const { accent, label } = TONE_CONFIG[tone]
  const Icon = tone === 'setup' ? Wrench : tone === 'error' ? AlertTriangle : ShieldCheck
  const eyebrow =
    tone === 'setup' ? 'Setup required' : tone === 'error' ? 'Connection issue' : 'Workspace status'

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8f9fa] px-4 py-10">
      <section className="app-state-enter w-full max-w-md overflow-hidden rounded-[0.4rem] bg-white outline outline-1 outline-[#d4dde8] shadow-[0_30px_70px_-44px_rgba(0,33,71,0.42)]">
        <div className="relative h-[3px] overflow-hidden bg-[#eef2f6]">
          <div className="absolute inset-0" style={{ backgroundColor: accent }} />
        </div>

        <div className="space-y-7 p-7 sm:p-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-[0.4rem] bg-white outline outline-1 outline-[#e1e6ec]">
              <img src={stPaulosLogo} alt="St Paul's logo" className="h-full w-full object-cover" />
            </div>
            <div>
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[#005db6]">
                St Paul's Hospital
              </p>
              <p className="font-display text-[1.05rem] font-bold tracking-[-0.02em] text-[#000a1e]">
                Internal Medicine
              </p>
            </div>
          </div>

          <div className="space-y-3.5">
            <div className="flex items-center gap-2">
              <span
                className="text-[11px] font-semibold uppercase tracking-[0.2em]"
                style={{ color: label }}
              >
                {eyebrow}
              </span>
              <Icon
                className="h-3.5 w-3.5"
                style={{ color: accent }}
              />
            </div>

            <h1 className="font-display text-[2rem] font-bold leading-[1.02] tracking-[-0.035em] text-[#000a1e] sm:text-[2.3rem]">
              {title}
            </h1>

            <p className="text-sm leading-7 text-[#5b6169]">{description}</p>
          </div>

          {detail ? (
            <div className="rounded-[0.35rem] bg-[#f7f9fc] px-4 py-3.5 text-sm leading-7 text-[#44474e] outline outline-1 outline-[#e6ecf3]">
              {detail}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
