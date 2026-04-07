import {
  AlertTriangle,
  CircleDashed,
  ShieldCheck,
  Wrench,
} from 'lucide-react'

import stPaulosLogo from '@/assets/StPaulosLogoColor.jpg'
import { cn } from '@/lib/utils'

type ScreenTone = 'loading' | 'setup' | 'error' | 'info'

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
  const Icon =
    tone === 'loading'
      ? CircleDashed
      : tone === 'setup'
        ? Wrench
        : tone === 'error'
          ? AlertTriangle
          : ShieldCheck
  const eyebrow =
    tone === 'loading'
      ? 'Loading workspace'
      : tone === 'setup'
        ? 'Setup required'
        : tone === 'error'
          ? 'Connection issue'
          : 'Workspace status'

  return (
    <div className="min-h-screen bg-[#f8f9fa] px-4 py-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl items-center justify-center">
        <section className="w-full overflow-hidden rounded-[0.35rem] border border-[#d9e0e7] bg-[linear-gradient(180deg,#ffffff_0%,#f1f5fa_100%)] shadow-[0_24px_48px_rgba(0,33,71,0.08)]">
          <div className="h-1 bg-[linear-gradient(90deg,#005db6_0%,#63a1ff_72%,#f0b429_100%)]" />

          <div className="space-y-8 p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-[6px] bg-white ring-1 ring-[#d7dbe0]">
                <img
                  src={stPaulosLogo}
                  alt="St Paulos logo"
                  className="h-full w-full object-cover"
                />
              </div>

              <div>
                <p className="text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[#005db6]">
                  St Paulos Hospital
                </p>
                <p className="font-display text-[1.1rem] text-[#000a1e]">
                  Internal Medicine
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-[0.25rem] border border-[#d4dde8] bg-[#ffffff] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#005db6]">
                <Icon
                  className={cn(
                    'h-3.5 w-3.5',
                    tone === 'error' && 'text-[#ba1a1a]',
                    tone === 'setup' && 'text-[#8a5a00]',
                  )}
                />
                {eyebrow}
              </div>

              <h1 className="font-display text-[2rem] leading-[0.98] tracking-[-0.04em] text-[#000a1e] sm:text-[2.4rem]">
                {title}
              </h1>

              <p className="max-w-[34rem] text-sm leading-7 text-[#5b6169]">
                {description}
              </p>
            </div>

            {detail ? (
              <div className="rounded-[0.35rem] border border-[#d9e0e7] bg-[#ffffff] px-4 py-4 text-sm leading-7 text-[#44474e]">
                {detail}
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}
