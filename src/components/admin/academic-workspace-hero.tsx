import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

export type AcademicHeroMetric = {
  label: string;
  value: string;
  note?: string;
  compact?: boolean;
};

type AcademicWorkspaceHeroProps = {
  eyebrow: string;
  title: string;
  description: string;
  metrics?: AcademicHeroMetric[];
  actions?: ReactNode;
};

/**
 * Shared orientation layer for academic admin workspaces. It mirrors the
 * evaluation dashboard's navy, gold, and white hierarchy while keeping the
 * working controls in the quieter surface that follows it.
 */
export function AcademicWorkspaceHero({
  eyebrow,
  title,
  description,
  metrics = [],
  actions,
}: AcademicWorkspaceHeroProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="overflow-hidden rounded-[0.35rem] bg-[#04162f] px-5 py-6 text-white shadow-[0_26px_64px_-40px_rgba(0,12,35,0.85)] md:px-7 md:py-7"
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-3 w-[3px] rounded-full bg-[#f0b429]"
            />
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#f0b429]">
              {eyebrow}
            </p>
          </div>
          <h1 className="mt-2 font-display text-[1.6rem] font-bold leading-tight tracking-[-0.02em] text-white md:text-[1.95rem]">
            {title}
          </h1>
          <p className="mt-2 text-[15px] leading-6 text-[#b6c5d8]">{description}</p>
        </div>

        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>

      {metrics.length > 0 ? (
        <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-5 border-t border-white/10 pt-5 lg:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="min-w-0">
              <p className="min-h-8 text-xs font-semibold uppercase leading-4 tracking-[0.14em] text-[#f0b429]">
                {metric.label}
              </p>
              <p
                className={`mt-1.5 truncate font-display font-bold leading-none tabular-nums text-white ${
                  metric.compact
                    ? 'text-[1.35rem] md:text-[1.55rem]'
                    : 'text-[1.75rem] md:text-[2rem]'
                }`}
              >
                {metric.value}
              </p>
              {metric.note ? (
                <p className="mt-1 text-[13px] leading-5 text-[#b6c5d8]">
                  {metric.note}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </motion.section>
  );
}
