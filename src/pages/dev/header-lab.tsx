/**
 * Dev-only design lab: alternatives for the app-shell top bar.
 * Mounted at /design-lab/header behind `import.meta.env.DEV` — never ships.
 * Self-contained: nothing here imports the real shell, so it cannot affect it.
 */
import { Bell, ChevronDown, LogOut } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

const EYEBROW = 'Academic operations'
const TITLE = 'Audit Log'
const PERIOD = 'Jul 20 - Jul 26, 2026'
const USER = { initials: 'SP', name: 'St Paul Admin', role: 'Maintenance' }
const UNREAD = 3

/** Shared unread pip so the three options stay comparable. */
function UnreadBadge() {
  return (
    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ba1a1a] px-1 text-[10px] font-bold text-white ring-2 ring-white">
      {UNREAD}
    </span>
  )
}

/** Avatar tile, identical across options so only the surrounding chrome varies. */
function AvatarTile({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-[0.35rem] bg-[#04162f] font-bold text-[#f0b429]',
        size === 'sm' ? 'h-8 w-8 text-[0.72rem]' : 'h-9 w-9 text-[0.78rem]',
      )}
    >
      {USER.initials}
    </span>
  )
}

/** Account menu used by the options that move Sign out off the top bar. */
function AccountMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-56 overflow-hidden rounded-[0.4rem] border border-[#e1e6ec] bg-white py-1 shadow-[0_18px_40px_-24px_rgba(0,20,55,0.45)]">
        <div className="border-b border-[#eef2f6] px-3 py-2.5">
          <p className="truncate text-[13.5px] font-semibold text-[#000a1e]">{USER.name}</p>
          <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8794a5]">
            {USER.role}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13.5px] font-medium text-[#44474e] transition-colors hover:bg-[#f6f8fa] hover:text-[#ba1a1a]"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Option A — Quiet rail
// ---------------------------------------------------------------------------

function OptionAQuiet() {
  const [open, setOpen] = useState(false)

  return (
    <header className="border-b border-[#e7ecf1] bg-white">
      <div className="flex items-center justify-between gap-4 px-5 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#005db6]">
            {EYEBROW}
          </p>
          <h1 className="mt-1 truncate font-display text-[1.4rem] font-bold leading-tight tracking-[-0.03em] text-[#000a1e]">
            {TITLE}
          </h1>
        </div>

        <div className="flex items-center gap-1">
          <span className="hidden items-center gap-2 pr-1 text-[13px] text-[#5b6169] lg:flex">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#f0b429]" />
            {PERIOD}
          </span>

          <span aria-hidden className="mx-2 hidden h-5 w-px bg-[#e7ecf1] lg:block" />

          <button
            type="button"
            aria-label="Notifications"
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-[0.35rem] text-[#5b6169] transition-colors hover:bg-[#f1f4f8] hover:text-[#000a1e]"
          >
            <Bell className="h-[18px] w-[18px]" />
            <UnreadBadge />
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="inline-flex items-center gap-2 rounded-[0.35rem] py-1 pl-1 pr-2 transition-colors hover:bg-[#f1f4f8]"
            >
              <AvatarTile size="sm" />
              <span className="hidden text-left sm:block">
                <span className="block text-[13.5px] font-semibold leading-tight text-[#000a1e]">
                  {USER.name}
                </span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-[#8794a5]" />
            </button>
            <AccountMenu open={open} onClose={() => setOpen(false)} />
          </div>
        </div>
      </div>
    </header>
  )
}

// ---------------------------------------------------------------------------
// Option B — Unified cluster
// ---------------------------------------------------------------------------

function OptionBCluster() {
  return (
    <header className="border-b border-[#e7ecf1] bg-white">
      <div className="flex items-center justify-between gap-4 px-5 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#005db6]">
            {EYEBROW}
          </p>
          <h1 className="mt-1 truncate font-display text-[1.4rem] font-bold leading-tight tracking-[-0.03em] text-[#000a1e]">
            {TITLE}
          </h1>
        </div>

        <div className="flex items-stretch overflow-hidden rounded-[0.4rem] border border-[#e1e6ec] bg-white">
          <div className="hidden items-center gap-2.5 px-3.5 lg:flex">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#f0b429]" />
            <span className="leading-tight">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8794a5]">
                Reporting period
              </span>
              <span className="block text-[13px] font-semibold tracking-[-0.01em] text-[#000a1e]">
                {PERIOD}
              </span>
            </span>
          </div>

          <button
            type="button"
            aria-label="Notifications"
            className="relative inline-flex w-11 items-center justify-center border-l border-[#e7ecf1] text-[#5b6169] transition-colors first:border-l-0 hover:bg-[#f6f8fa] hover:text-[#000a1e]"
          >
            <Bell className="h-[18px] w-[18px]" />
            <UnreadBadge />
          </button>

          <div className="hidden items-center gap-2.5 border-l border-[#e7ecf1] px-3 sm:flex">
            <AvatarTile size="sm" />
            <span className="text-left leading-tight">
              <span className="block text-[13.5px] font-semibold text-[#000a1e]">
                {USER.name}
              </span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8794a5]">
                {USER.role}
              </span>
            </span>
          </div>

          <button
            type="button"
            aria-label="Sign out"
            className="inline-flex w-11 items-center justify-center border-l border-[#e7ecf1] text-[#8794a5] transition-colors hover:bg-[#f6f8fa] hover:text-[#ba1a1a]"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  )
}

// ---------------------------------------------------------------------------
// Option C — Anchored title
// ---------------------------------------------------------------------------

function OptionCAnchored() {
  const [open, setOpen] = useState(false)

  return (
    <header className="border-b border-[#e7ecf1] bg-white">
      <div className="flex items-start justify-between gap-4 px-5 py-3.5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#005db6]">
            {EYEBROW}
          </p>
          <h1 className="mt-1 truncate font-display text-[1.5rem] font-bold leading-tight tracking-[-0.03em] text-[#000a1e]">
            {TITLE}
          </h1>
          <p className="mt-1.5 flex items-center gap-2 text-[12.5px] text-[#74777f]">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#f0b429]" />
            Reporting period
            <span aria-hidden className="text-[#c2cad4]">·</span>
            <span className="font-semibold text-[#5b6169]">{PERIOD}</span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            aria-label="Notifications"
            className="relative inline-flex h-10 w-10 items-center justify-center rounded-[0.4rem] border border-[#e1e6ec] bg-white text-[#5b6169] transition-colors hover:border-[#c8d5e6] hover:bg-[#f6f8fa] hover:text-[#000a1e]"
          >
            <Bell className="h-[18px] w-[18px]" />
            <UnreadBadge />
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label="Account"
              className="inline-flex h-10 items-center gap-2 rounded-[0.4rem] border border-[#e1e6ec] bg-white pl-1.5 pr-2.5 transition-colors hover:border-[#c8d5e6] hover:bg-[#f6f8fa]"
            >
              <AvatarTile size="sm" />
              <ChevronDown className="h-3.5 w-3.5 text-[#8794a5]" />
            </button>
            <AccountMenu open={open} onClose={() => setOpen(false)} />
          </div>
        </div>
      </div>
    </header>
  )
}

// ---------------------------------------------------------------------------
// Preview scaffolding
// ---------------------------------------------------------------------------

function Frame({
  index,
  title,
  verdict,
  notes,
  children,
}: {
  index: string
  title: string
  verdict: string
  notes: string[]
  children: ReactNode
}) {
  return (
    <section className="rounded-[0.35rem] bg-white p-5 outline outline-1 outline-[#e1e7ee] shadow-[0_20px_40px_rgba(0,33,71,0.06)] md:p-7">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="rounded-[0.25rem] bg-[#04162f] px-2 py-1 text-[11px] font-bold tracking-[0.1em] text-white">
          {index}
        </span>
        <h2 className="font-display text-[1.35rem] font-bold tracking-[-0.02em] text-[#000a1e]">
          {title}
        </h2>
        <p className="text-[13.5px] text-[#5b6169]">{verdict}</p>
      </div>

      <div className="mt-6 overflow-hidden rounded-[0.3rem] border border-[#e6ebf1] bg-[#f8f9fa]">
        {children}
        <div className="px-5 py-8 text-[13px] text-[#98a2ae]">Page content sits here.</div>
      </div>

      <ul className="mt-5 grid gap-1.5 text-[13.5px] leading-6 text-[#44474e] sm:grid-cols-2">
        {notes.map((note) => (
          <li key={note} className="flex gap-2">
            <span aria-hidden className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[#005db6]" />
            {note}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function HeaderLabPage() {
  return (
    <div className="min-h-screen bg-[#f8f9fa] px-4 py-8 md:px-8 md:py-12">
      <div className="mx-auto flex max-w-[76rem] flex-col gap-8">
        <header>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#005db6]">
            Design lab
          </p>
          <h1 className="mt-2 font-display text-[1.9rem] font-bold tracking-[-0.02em] text-[#000a1e]">
            App shell top bar
          </h1>
          <p className="mt-2 max-w-[64ch] text-[15px] leading-6 text-[#5b6169]">
            Three replacements for the header. Click the avatar in A and C to see
            where Sign out moves to. The real shell is untouched.
          </p>
        </header>

        <section className="rounded-[0.35rem] border border-dashed border-[#c9d3df] bg-white/60 p-5 md:p-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8a929c]">
            Current, for comparison
          </p>
          <div className="mt-4 overflow-hidden rounded-[0.3rem] border border-[#e6ebf1]">
            <header className="border-b border-[#e7ecf1] bg-white">
              <div className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#005db6]">
                    {EYEBROW}
                  </p>
                  <h1 className="mt-1 font-display text-[1.4rem] font-bold leading-tight tracking-[-0.03em] text-[#000a1e]">
                    {TITLE}
                  </h1>
                </div>
                <div className="flex items-center gap-2.5">
                  <div className="hidden items-center gap-2.5 rounded-[0.4rem] border border-[#e1e6ec] bg-white px-3.5 py-2 lg:flex">
                    <span className="h-2 w-2 rounded-full bg-[#f0b429]" />
                    <div className="leading-tight">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#74777f]">
                        Reporting period
                      </p>
                      <p className="font-display text-[0.92rem] font-semibold leading-none tracking-[-0.02em] text-[#000a1e]">
                        {PERIOD}
                      </p>
                    </div>
                  </div>
                  <span className="relative inline-flex h-10 w-10 items-center justify-center rounded-[0.4rem] border border-[#e1e6ec] bg-white text-[#44474e]">
                    <Bell className="h-4 w-4" />
                  </span>
                  <div className="hidden items-center gap-2.5 rounded-[0.4rem] border border-[#e1e6ec] bg-white py-1.5 pl-2.5 pr-1.5 sm:flex">
                    <AvatarTile />
                    <div className="text-left">
                      <p className="text-sm font-semibold leading-tight tracking-[-0.01em] text-[#000a1e]">
                        {USER.name}
                      </p>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#74777f]">
                        {USER.role}
                      </p>
                    </div>
                    <span className="ml-0.5 inline-flex h-9 w-9 items-center justify-center rounded-[0.3rem] border-l border-[#e1e6ec] pl-2 text-[#74777f]">
                      <LogOut className="h-4 w-4" />
                    </span>
                  </div>
                </div>
              </div>
            </header>
          </div>
          <ul className="mt-4 grid gap-1.5 text-[13.5px] leading-6 text-[#5b6169] sm:grid-cols-2">
            <li>Three bordered boxes in a row, three different heights and shapes.</li>
            <li>Sign out is nested inside the user box behind its own divider.</li>
            <li>Ambient info (the week) carries as much chrome as the controls.</li>
            <li>The middle is empty while the right edge is crowded.</li>
          </ul>
        </section>

        <Frame
          index="A"
          title="Quiet rail"
          verdict="Fewest boxes. Controls recede until hovered."
          notes={[
            'No borders on the right at all; the hairline under the header does the separating.',
            'The week becomes plain text, which is what ambient information should look like.',
            'Sign out moves into an avatar menu, so it cannot be hit by accident.',
            'Leaves the most room for a page action or search later.',
          ]}
        >
          <OptionAQuiet />
        </Frame>

        <Frame
          index="B"
          title="Unified cluster"
          verdict="Keeps the boxes, makes them one object."
          notes={[
            'One border, one radius, one height, with hairline dividers between segments.',
            'Closest to what you have now, so the least retraining.',
            'Sign out stays visible as its own segment rather than nested in the user box.',
            'Still a heavy block at the right edge.',
          ]}
        >
          <OptionBCluster />
        </Frame>

        <Frame
          index="C"
          title="Anchored title"
          verdict="Moves the week to where it means something."
          notes={[
            'The reporting period sits under the page title as context, not as a control.',
            'The right side reduces to two equal buttons, which reads as calm.',
            'Name and role move into the avatar menu, freeing the top bar.',
            'The tallest of the three; costs about 20px of vertical space.',
          ]}
        >
          <OptionCAnchored />
        </Frame>

        <footer className="pb-4 text-[13.5px] leading-6 text-[#5b6169]">
          All three keep the unread badge, keep the sync dot slot, and collapse the
          same way on small screens: the period hides first, then the user name,
          leaving the avatar and bell.
        </footer>
      </div>
    </div>
  )
}
