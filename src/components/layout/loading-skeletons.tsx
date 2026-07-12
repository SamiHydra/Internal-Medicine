import type { ReactNode } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { panelClass } from '@/components/dashboard/section-panel'

function LoadingRegion({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

function PanelSkeleton({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <section className={cn(panelClass, className)}>{children}</section>
}

function HeaderSkeleton({ compact = false, dark = false }: { compact?: boolean; dark?: boolean }) {
  return (
    <div className={cn('flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between', dark ? 'border-white/10' : 'border-[#eef2f6]')}>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex items-center gap-2">
          <Skeleton className={cn('h-3 w-[3px] rounded-full', dark && 'bg-white/24')} />
          <Skeleton className={cn('h-2.5 w-32', dark && 'bg-white/18')} />
        </div>
        <Skeleton className={cn(compact ? 'h-6 w-56' : 'h-8 w-full max-w-md', dark && 'bg-white/20')} />
        {!compact ? <Skeleton className={cn('h-3 w-full max-w-xl', dark && 'bg-white/14')} /> : null}
      </div>
      <div className="flex gap-2.5">
        <Skeleton className={cn('h-9 w-24', dark && 'bg-white/18')} />
        <Skeleton className={cn('h-9 w-20', dark && 'bg-white/18')} />
      </div>
    </div>
  )
}

function StatStripSkeleton({ dark = false }: { dark?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-5 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="min-w-0 space-y-2">
          <Skeleton className={cn('h-2.5 w-24', dark && 'bg-white/18')} />
          <Skeleton className={cn('h-9 w-20', dark && 'bg-white/22')} />
          <Skeleton className={cn('h-2.5 w-28', dark && 'bg-white/14')} />
        </div>
      ))}
    </div>
  )
}

export function HeroSkeleton({ dark = false }: { dark?: boolean }) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-[0.35rem] px-5 py-6 shadow-[0_26px_64px_-40px_rgba(0,12,35,0.5)] md:px-7 md:py-7',
        dark ? 'bg-[#04162f]' : 'bg-white outline outline-1 outline-[#d4dde8]',
      )}
    >
      <HeaderSkeleton dark={dark} />
      <div className={cn('mt-6 border-t pt-5', dark ? 'border-white/10' : 'border-[#eef2f6]')}>
        <StatStripSkeleton dark={dark} />
      </div>
    </section>
  )
}

export function TableSkeleton({
  rows = 6,
  columns = 4,
  className,
}: {
  rows?: number
  columns?: number
  className?: string
}) {
  const gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`

  return (
    <LoadingRegion label="Loading table" className={cn('overflow-hidden rounded-[0.4rem] border border-[#e6ecf3]', className)}>
      <div
        className="grid gap-3 border-b border-[#eef2f6] bg-[#f7f9fc] px-4 py-2.5"
        style={{ gridTemplateColumns }}
      >
        {Array.from({ length: columns }).map((_, index) => (
          <Skeleton key={index} className="h-2.5 w-2/3" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="grid items-center gap-3 border-b border-[#eef2f6] px-4 py-3 last:border-b-0"
          style={{ gridTemplateColumns }}
        >
          {Array.from({ length: columns }).map((_, columnIndex) => (
            <Skeleton
              key={columnIndex}
              className={cn(
                'h-3.5',
                columnIndex === 0 ? 'w-full' : columnIndex === columns - 1 ? 'ml-auto w-12' : 'w-3/4',
              )}
            />
          ))}
        </div>
      ))}
    </LoadingRegion>
  )
}

export function ListSkeleton({
  rows = 5,
  className,
}: {
  rows?: number
  className?: string
}) {
  return (
    <LoadingRegion label="Loading list" className={cn('space-y-2.5', className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="rounded-[0.4rem] border border-[#e6ecf3] bg-white p-4 md:p-5">
          <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[40px_minmax(0,1fr)_170px] lg:items-start">
            <Skeleton className="h-10 w-10 rounded-[0.35rem]" />
            <div className="min-w-0 space-y-2.5">
              <div className="flex gap-2">
                <Skeleton className="h-5 w-20 rounded-full" />
                {index % 2 === 0 ? <Skeleton className="h-5 w-16 rounded-full" /> : null}
              </div>
              <Skeleton className="h-4 w-full max-w-lg" />
              <Skeleton className="h-3 w-full max-w-2xl" />
            </div>
            <div className="space-y-2 lg:text-right">
              <Skeleton className="h-3.5 w-28 lg:ml-auto" />
              <Skeleton className="h-3 w-16 lg:ml-auto" />
            </div>
          </div>
        </div>
      ))}
    </LoadingRegion>
  )
}

export function ChartSkeleton({
  height = 260,
  className,
}: {
  height?: number
  className?: string
}) {
  return (
    <PanelSkeleton className={className}>
      <HeaderSkeleton compact />
      <div className="mt-6 space-y-4" style={{ minHeight: height }}>
        <div className="flex h-full min-h-[220px] items-end gap-3 rounded-[0.4rem] border border-[#e6ecf3] bg-[#f8fafc] px-4 py-5">
          {Array.from({ length: 9 }).map((_, index) => (
            <Skeleton
              key={index}
              className="w-full rounded-t-[0.25rem]"
              style={{ height: `${38 + ((index * 17) % 56)}%` }}
            />
          ))}
        </div>
      </div>
    </PanelSkeleton>
  )
}

export function DashboardContentSkeleton() {
  return (
    <LoadingRegion label="Loading dashboard content" className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <PanelSkeleton>
        <HeaderSkeleton compact />
        <div className="mt-5 space-y-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-3.5 w-48" />
                <Skeleton className="h-3.5 w-10" />
              </div>
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          ))}
        </div>
      </PanelSkeleton>
      <PanelSkeleton>
        <HeaderSkeleton compact />
        <div className="mt-5 space-y-2.5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="rounded-[0.35rem] border border-[#e6ecf3] bg-[#f8fafc] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-3/5" />
                  <Skeleton className="h-3 w-2/5" />
                </div>
                <Skeleton className="h-7 w-14" />
              </div>
            </div>
          ))}
        </div>
      </PanelSkeleton>
    </LoadingRegion>
  )
}

export function AnalyticsContentSkeleton() {
  return (
    <LoadingRegion label="Loading analytics" className="space-y-6">
      <ChartSkeleton height={260} />
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartSkeleton height={260} />
        <ChartSkeleton height={260} />
      </div>
      <PanelSkeleton>
        <HeaderSkeleton compact />
        <div className="mt-5">
          <TableSkeleton rows={5} columns={5} />
        </div>
      </PanelSkeleton>
    </LoadingRegion>
  )
}

export function FormContentSkeleton() {
  return (
    <LoadingRegion label="Loading form" className="grid gap-8 2xl:grid-cols-[minmax(0,1fr)_320px] 2xl:items-start">
      <PanelSkeleton>
        <HeaderSkeleton compact />
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className={cn('space-y-2', index > 5 && 'md:col-span-2')}>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-11 w-full" />
            </div>
          ))}
        </div>
        <div className="mt-6 flex justify-end gap-3 border-t border-[#eef2f6] pt-5">
          <Skeleton className="h-10 w-28" />
          <Skeleton className="h-10 w-32" />
        </div>
      </PanelSkeleton>
      <PanelSkeleton>
        <HeaderSkeleton compact />
        <div className="mt-5 space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      </PanelSkeleton>
    </LoadingRegion>
  )
}

export function ReportContentSkeleton() {
  return (
    <LoadingRegion label="Loading report" className={panelClass}>
      <HeaderSkeleton />
      <div className="mt-6 grid gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-16 rounded-[0.35rem]" />
        ))}
      </div>
      <div className="mt-6 overflow-hidden rounded-[0.4rem] border border-[#e6ecf3]">
        {Array.from({ length: 6 }).map((_, rowIndex) => (
          <div key={rowIndex} className="grid grid-cols-[minmax(0,1.2fr)_repeat(7,minmax(3rem,1fr))] gap-3 border-b border-[#eef2f6] px-4 py-3 last:border-b-0">
            <Skeleton className="h-4 w-full" />
            {Array.from({ length: 7 }).map((__, columnIndex) => (
              <Skeleton key={columnIndex} className="h-9 w-full" />
            ))}
          </div>
        ))}
      </div>
    </LoadingRegion>
  )
}

export function TemplateEditorSkeleton() {
  return (
    <LoadingRegion label="Loading templates" className="space-y-5">
      {Array.from({ length: 2 }).map((_, index) => (
        <PanelSkeleton key={index}>
          <HeaderSkeleton compact />
          <div className="mt-5 space-y-5">
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 7 }).map((__, dayIndex) => (
                <Skeleton key={dayIndex} className="h-8 w-12 rounded-full" />
              ))}
            </div>
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((__, fieldIndex) => (
                <div key={fieldIndex} className="rounded-[0.4rem] border border-[#e6ecf3] bg-[#f7f9fc] p-4">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px_48px] lg:items-center">
                    <div className="space-y-2">
                      <Skeleton className="h-9 w-full" />
                      <Skeleton className="h-3 w-44" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Skeleton className="h-9 w-full" />
                      <Skeleton className="h-9 w-full" />
                    </div>
                    <Skeleton className="h-6 w-10 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </PanelSkeleton>
      ))}
    </LoadingRegion>
  )
}

export function PageSkeleton({
  variant = 'dashboard',
  className,
}: {
  variant?: 'dashboard' | 'analytics' | 'form' | 'table' | 'list'
  className?: string
}) {
  return (
    <LoadingRegion label="Loading page" className={cn('space-y-6 px-4 py-6 md:px-6 md:py-8', className)}>
      <HeroSkeleton dark={variant === 'analytics'} />
      {variant === 'form' ? (
        <FormContentSkeleton />
      ) : variant === 'analytics' ? (
        <AnalyticsContentSkeleton />
      ) : variant === 'table' ? (
        <PanelSkeleton>
          <HeaderSkeleton compact />
          <div className="mt-5">
            <TableSkeleton rows={7} columns={5} />
          </div>
        </PanelSkeleton>
      ) : variant === 'list' ? (
        <PanelSkeleton>
          <HeaderSkeleton compact />
          <div className="mt-5">
            <ListSkeleton rows={5} />
          </div>
        </PanelSkeleton>
      ) : (
        <DashboardContentSkeleton />
      )}
    </LoadingRegion>
  )
}

export function FullPageSkeleton({ label = 'Loading workspace' }: { label?: string }) {
  return (
    <LoadingRegion
      label={label}
      className="flex min-h-screen items-center justify-center bg-[#f8f9fa] px-4 py-10"
    >
      <div className="w-full max-w-4xl space-y-6">
        <PanelSkeleton className="overflow-hidden">
          <div className="flex items-center gap-3 border-b border-[#eef2f6] pb-5">
            <Skeleton className="h-11 w-11 rounded-[0.4rem]" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-5 w-44" />
            </div>
          </div>
          <div className="mt-6 space-y-4">
            <Skeleton className="h-9 w-full max-w-md" />
            <Skeleton className="h-3 w-full max-w-xl" />
            <Skeleton className="h-3 w-full max-w-lg" />
          </div>
          <div className="mt-7 grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-20 rounded-[0.35rem]" />
            ))}
          </div>
        </PanelSkeleton>
      </div>
    </LoadingRegion>
  )
}
