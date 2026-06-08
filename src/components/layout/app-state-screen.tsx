import { AlertTriangle, ShieldCheck, Wrench } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'

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
  const reduceMotion = useReducedMotion()
  const tone = resolveScreenTone(title)

  if (tone === 'loading') {
    return <FullPageSkeleton label={title} />
  }

  const { accent, label } = TONE_CONFIG[tone]
  const Icon = tone === 'setup' ? Wrench : tone === 'error' ? AlertTriangle : ShieldCheck
  const eyebrow =
    tone === 'setup' ? 'Setup required' : tone === 'error' ? 'Connection issue' : 'Workspace status'
  const animateBar = false

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8f9fa] px-4 py-10">
      <motion.section
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.26, ease: [0.23, 1, 0.32, 1] }}
        className="w-full max-w-md overflow-hidden rounded-[0.4rem] bg-white outline outline-1 outline-[#d4dde8] shadow-[0_30px_70px_-44px_rgba(0,33,71,0.42)]"
      >
        {/* Top status bar: indeterminate sweep while loading, solid accent otherwise. */}
        <div className="relative h-[3px] overflow-hidden bg-[#eef2f6]">
          {animateBar ? (
            <motion.div
              className="absolute inset-y-0 left-0 w-1/3 rounded-full"
              style={{ backgroundColor: accent }}
              initial={{ x: '-110%' }}
              animate={{ x: '320%' }}
              transition={{ duration: 1.15, ease: 'easeInOut', repeat: Infinity }}
            />
          ) : (
            <div className="absolute inset-0" style={{ backgroundColor: accent }} />
          )}
        </div>

        <div className="space-y-7 p-7 sm:p-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-[0.4rem] bg-white outline outline-1 outline-[#e1e6ec]">
              <img src={stPaulosLogo} alt="St Paul logo" className="h-full w-full object-cover" />
            </div>
            <div>
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[#005db6]">
                St Paul Hospital
              </p>
              <p className="font-display text-[1.05rem] font-bold tracking-[-0.02em] text-[#000a1e]">
                Internal Medicine
              </p>
            </div>
          </div>

          <div className="space-y-3.5">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="h-3 w-[3px] rounded-full bg-[#f0b429]" />
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
      </motion.section>
    </div>
  )
}
