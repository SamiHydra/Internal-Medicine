/**
 * Dev-only design lab: alternatives for the academic-operations tab bar.
 * Mounted at /design-lab/tabs behind `import.meta.env.DEV` — never ships.
 * Nothing here imports from the real dashboard, so the live page is untouched.
 *
 * Round 2: round 1 sanded off the original's solid navy selection and came back
 * timid. These three all keep a high-contrast selected state and push it further.
 */
import { motion, useReducedMotion } from 'framer-motion'
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

type TabItem = {
  value: string
  label: string
  count: number
}

const TABS: TabItem[] = [
  { value: 'evaluations', label: 'Evaluations', count: 624 },
  { value: 'morning', label: 'Morning sessions', count: 161 },
  { value: 'teaching', label: 'Teaching activities', count: 70 },
  { value: 'students', label: 'Students', count: 36 },
]

/**
 * Roving tabindex + arrow-key navigation, the behaviour real tabs owe the
 * keyboard. Home/End jump to the ends; Left/Right wrap.
 */
function useTabKeyboard(
  value: string,
  onChange: (next: string) => void,
  items: TabItem[],
) {
  const listRef = useRef<HTMLDivElement>(null)

  function focusIndex(index: number) {
    const buttons =
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    buttons?.[index]?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = items.findIndex((item) => item.value === value)
    let next = -1

    if (event.key === 'ArrowRight') next = (current + 1) % items.length
    if (event.key === 'ArrowLeft') next = (current - 1 + items.length) % items.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = items.length - 1
    if (next === -1) return

    event.preventDefault()
    onChange(items[next].value)
    focusIndex(next)
  }

  return { listRef, onKeyDown }
}

/** Selection slide, shared by every option. Snappy, not springy-cute. */
function useSlide() {
  const reduceMotion = useReducedMotion()
  return reduceMotion
    ? { duration: 0 }
    : ({ type: 'spring', stiffness: 560, damping: 44 } as const)
}

const scrollRail =
  'overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

// ---------------------------------------------------------------------------
// Option D — Navy rail, gold selection
// ---------------------------------------------------------------------------

function OptionDNavyRail({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const { listRef, onKeyDown } = useTabKeyboard(value, onChange, TABS)
  const slide = useSlide()

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Academic operations"
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex max-w-full gap-1 rounded-[0.35rem] bg-[#04162f] p-1.5 shadow-[0_20px_44px_-26px_rgba(0,12,35,0.95)]',
        scrollRail,
      )}
    >
      {TABS.map((tab) => {
        const active = tab.value === value
        return (
          <button
            key={tab.value}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.value)}
            className={cn(
              'relative shrink-0 rounded-[0.25rem] px-4 py-2 text-[14px] tracking-[-0.01em] transition-colors duration-150',
              'outline-none focus-visible:ring-2 focus-visible:ring-[#f0b429] focus-visible:ring-offset-2 focus-visible:ring-offset-[#04162f]',
              active
                ? 'font-bold text-[#00182f]'
                : 'font-semibold text-[#9fb0c6] hover:bg-white/[0.07] hover:text-white',
            )}
          >
            {active ? (
              <motion.span
                layoutId="navy-rail-chip"
                aria-hidden
                className="absolute inset-0 rounded-[0.25rem] bg-[#f0b429]"
                transition={slide}
              />
            ) : null}
            <span className="relative flex items-center gap-2 whitespace-nowrap">
              {tab.label}
              <span
                className={cn(
                  'text-[12px] font-bold tabular-nums',
                  active ? 'text-[#00182f]/60' : 'text-[#6d8199]',
                )}
              >
                {tab.count}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Option E — Hardened chip, no container
// ---------------------------------------------------------------------------

function OptionEHardened({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const { listRef, onKeyDown } = useTabKeyboard(value, onChange, TABS)
  const slide = useSlide()

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Academic operations"
      onKeyDown={onKeyDown}
      className={cn('-mx-4 flex gap-1.5 px-4 sm:mx-0 sm:px-0', scrollRail)}
    >
      {TABS.map((tab) => {
        const active = tab.value === value
        return (
          <button
            key={tab.value}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.value)}
            className={cn(
              'relative shrink-0 rounded-[0.3rem] px-4 py-2.5 text-[14.5px] tracking-[-0.015em] transition-colors duration-150',
              'outline-none focus-visible:ring-2 focus-visible:ring-[#005db6]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f8f9fa]',
              active
                ? 'font-bold text-white'
                : 'font-medium text-[#5b6169] hover:bg-[#e7ecf2] hover:text-[#000a1e]',
            )}
          >
            {active ? (
              <motion.span
                layoutId="hardened-chip"
                aria-hidden
                className="absolute inset-0 rounded-[0.3rem] bg-[#04162f] shadow-[0_10px_22px_-12px_rgba(0,12,35,0.9)]"
                transition={slide}
              >
                <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-[#f0b429]" />
              </motion.span>
            ) : null}
            <span className="relative flex items-center gap-2 whitespace-nowrap">
              {tab.label}
              <span
                className={cn(
                  'text-[12px] font-bold tabular-nums',
                  active ? 'text-[#f0b429]' : 'text-[#98a2ae]',
                )}
              >
                {tab.count}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Option F — Typographic rail
// ---------------------------------------------------------------------------

function OptionFTypographic({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const { listRef, onKeyDown } = useTabKeyboard(value, onChange, TABS)
  const slide = useSlide()

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Academic operations"
      onKeyDown={onKeyDown}
      className={cn('-mx-4 flex gap-7 px-4 sm:mx-0 sm:px-0', scrollRail)}
    >
      {TABS.map((tab) => {
        const active = tab.value === value
        return (
          <button
            key={tab.value}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.value)}
            className={cn(
              'relative shrink-0 rounded-[3px] pb-3 pt-1 text-[17px] tracking-[-0.02em] transition-colors duration-150',
              'outline-none focus-visible:ring-2 focus-visible:ring-[#005db6]/45 focus-visible:ring-offset-4 focus-visible:ring-offset-[#f8f9fa]',
              active
                ? 'font-bold text-[#000a1e]'
                : 'font-semibold text-[#a3adb9] hover:text-[#44474e]',
            )}
          >
            <span className="flex items-baseline gap-1.5 whitespace-nowrap">
              {tab.label}
              <span
                className={cn(
                  'text-[12px] font-bold tabular-nums',
                  active ? 'text-[#f0b429]' : 'text-[#c2cad4]',
                )}
              >
                {tab.count}
              </span>
            </span>
            {active ? (
              <motion.span
                layoutId="typographic-bar"
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-[#04162f]"
                transition={slide}
              />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Preview scaffolding
// ---------------------------------------------------------------------------

/** Stand-in for the analytics content, so each option is judged in context. */
function PanelStub({ label }: { label: string }) {
  return (
    <div className="rounded-[0.35rem] bg-white p-5 outline outline-1 outline-[#e1e7ee] shadow-[0_20px_40px_rgba(0,33,71,0.06)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#005db6]">
        {label}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {['Recorded', 'Not recorded', 'On time', 'Average delay'].map((metric) => (
          <div key={metric}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-[#8a929c]">
              {metric}
            </p>
            <p className="mt-1 font-display text-[1.4rem] font-bold tracking-[-0.02em] text-[#000a1e]">
              --
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function OptionCard({
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

      <div className="mt-6 rounded-[0.3rem] bg-[#f8f9fa] p-4 md:p-6">{children}</div>

      <ul className="mt-5 grid gap-1.5 text-[13.5px] leading-6 text-[#44474e] sm:grid-cols-2">
        {notes.map((note) => (
          <li key={note} className="flex gap-2">
            <span
              aria-hidden
              className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[#f0b429]"
            />
            {note}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function TabBarLabPage() {
  const [d, setD] = useState('morning')
  const [e, setE] = useState('morning')
  const [f, setF] = useState('morning')

  return (
    <div className="min-h-screen bg-[#f8f9fa] px-4 py-8 md:px-8 md:py-12">
      <div className="mx-auto flex max-w-[76rem] flex-col gap-8">
        <header>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#005db6]">
            Design lab, round 2
          </p>
          <h1 className="mt-2 font-display text-[1.9rem] font-bold tracking-[-0.02em] text-[#000a1e]">
            Academic operations tab bar
          </h1>
          <p className="mt-2 max-w-[62ch] text-[15px] leading-6 text-[#5b6169]">
            Round 1 went quieter than the original and lost its punch. These three
            keep the high-contrast selected state and push it three different ways:
            drench the container, sharpen the chip, or drop the box and let type
            carry the weight. Nothing on the real dashboard has changed.
          </p>
        </header>

        <section className="rounded-[0.35rem] border border-dashed border-[#c9d3df] bg-white/60 p-5 md:p-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8a929c]">
            Current, for comparison
          </p>
          <div className="mt-4 flex w-fit flex-wrap gap-1.5 rounded-[0.35rem] bg-white p-1.5 outline outline-1 outline-[#d4dde8]">
            {TABS.map((tab) => (
              <span
                key={tab.value}
                className={cn(
                  'rounded-[0.25rem] px-3.5 py-2 text-sm font-semibold',
                  tab.value === 'morning'
                    ? 'bg-[#04162f] text-white'
                    : 'text-[#44474e]',
                )}
              >
                {tab.label}
              </span>
            ))}
          </div>
          <p className="mt-4 max-w-[68ch] text-[13.5px] leading-6 text-[#5b6169]">
            The navy fill is the right instinct. What holds it back: the white
            outlined box around it competes with the chip inside, active and
            inactive share the same weight so only colour separates them, the gold
            accent used everywhere else in the admin is missing, and it carries no
            data.
          </p>
        </section>

        <OptionCard
          index="D"
          title="Navy rail, gold selection"
          verdict="Loudest. The whole control commits."
          notes={[
            'The container itself goes navy, so the bar has presence even unselected.',
            'Gold on navy is your existing accent pair, not a new colour.',
            'Matches the hero panel below it, reading as one deliberate block.',
            'Strongest option if the tab bar should anchor the top of the page.',
          ]}
        >
          <OptionDNavyRail value={d} onChange={setD} />
          <div className="mt-5">
            <PanelStub label={TABS.find((t) => t.value === d)?.label ?? ''} />
          </div>
        </OptionCard>

        <OptionCard
          index="E"
          title="Hardened chip"
          verdict="Your original with the timidity removed."
          notes={[
            'Same navy chip, but the competing outer box is gone.',
            'Bold against medium weight, so selection reads without relying on colour.',
            'Gold underline inside the chip lands the accent without a new surface.',
            'Lowest-risk change: structurally what you already have.',
          ]}
        >
          <OptionEHardened value={e} onChange={setE} />
          <div className="mt-5">
            <PanelStub label={TABS.find((t) => t.value === e)?.label ?? ''} />
          </div>
        </OptionCard>

        <OptionCard
          index="F"
          title="Typographic rail"
          verdict="Bold through scale, not fill."
          notes={[
            'Labels jump to 17px, so the tabs read as section headings.',
            'Near-black against pale grey is a harder contrast than any chip.',
            'A 3px navy bar marks position; no box anywhere on the page.',
            'Best if you want the page to start with content, not chrome.',
          ]}
        >
          <OptionFTypographic value={f} onChange={setF} />
          <div className="mt-5">
            <PanelStub label={TABS.find((t) => t.value === f)?.label ?? ''} />
          </div>
        </OptionCard>

        <footer className="pb-4 text-[13.5px] leading-6 text-[#5b6169]">
          All three are keyboard-complete: arrow keys move selection, Home and End
          jump to the ends, focus rings are visible, and the sliding indicator
          honours reduced-motion. Counts are placeholders here; the real analytics
          payloads already carry them.
        </footer>
      </div>
    </div>
  )
}
