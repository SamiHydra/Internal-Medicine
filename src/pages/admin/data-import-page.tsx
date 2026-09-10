import { useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'

import { panelClass, SectionEyebrow } from '@/components/dashboard/section-panel'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useAppData } from '@/context/app-data-context'
import { getCurrentPeriod, getVisibleReportingPeriods } from '@/data/selectors'
import { importReports, type ReportImportResult } from '@/lib/api/admin'
import { getApiBrowserClient } from '@/lib/api/client'
import { apiEnv, apiEnvSetupHint } from '@/lib/api/env'

function StepHeading({ step, label }: { step: number; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#edf1f5] text-xs font-bold text-[#1d3047]">
        {step}
      </span>
      <h2 className="font-display text-sm font-bold uppercase tracking-[0.16em] text-[#44474e]">{label}</h2>
    </div>
  )
}

export function DataImportPage() {
  const { state } = useAppData()
  const client = getApiBrowserClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Offer the same non-future periods the rest of the app shows (newest first),
  // and default to the current reporting period - not the latest future period -
  // so the selector matches the header instead of jumping ~6 months ahead.
  const periods = useMemo(
    () =>
      [...getVisibleReportingPeriods(state)].sort((a, b) =>
        b.weekStart.localeCompare(a.weekStart),
      ),
    [state],
  )
  const [periodId, setPeriodId] = useState<string>(() => getCurrentPeriod(state)?.id ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [submitOnImport, setSubmitOnImport] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [result, setResult] = useState<ReportImportResult | null>(null)

  const templateUrl = (format: 'xlsx' | 'csv') =>
    apiEnv.baseUrl && periodId
      ? `${apiEnv.baseUrl}/api/admin/reports/import-template?period=${periodId}&format=${format}`
      : undefined

  const runImport = async () => {
    if (!client || !file) {
      return
    }

    setIsImporting(true)
    setResult(null)
    try {
      const outcome = await importReports(client, file, submitOnImport)
      setResult(outcome)
      if (outcome.imported > 0) {
        toast.success(`Imported ${outcome.imported} report${outcome.imported === 1 ? '' : 's'}.`)
      } else {
        toast.error('No reports were imported - check the errors below.')
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to import the file.')
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className="space-y-6 px-4 py-5 md:px-6 md:py-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="flex items-center justify-between gap-4"
      >
        <SectionEyebrow label="Offline continuity" />
        {!apiEnv.baseUrl ? (
          <span className="text-sm text-[#8a5a00]">API not configured · {apiEnvSetupHint}</span>
        ) : null}
      </motion.div>

      <section className={panelClass}>
        <StepHeading step={1} label="Download template" />
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[#666970]">
              Reporting period
            </label>
            <Select value={periodId} onValueChange={setPeriodId}>
              <SelectTrigger className="w-full sm:w-[240px]" aria-label="Reporting period">
                <SelectValue placeholder="Select a period" />
              </SelectTrigger>
              <SelectContent>
                {periods.map((period) => (
                  <SelectItem key={period.id} value={period.id}>
                    {period.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary" disabled={!templateUrl('xlsx')}>
              <a href={templateUrl('xlsx')}>
                <Download className="h-3.5 w-3.5" />
                Excel template
              </a>
            </Button>
            <Button asChild variant="secondary" disabled={!templateUrl('csv')}>
              <a href={templateUrl('csv')}>
                <Download className="h-3.5 w-3.5" />
                CSV template
              </a>
            </Button>
          </div>
        </div>

        <div className="mt-6 border-t border-[#eef2f6] pt-6">
          <StepHeading step={2} label="Upload filled file" />
          <div className="mt-4 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                ref={fileInputRef}
                type="file"
                aria-label="Filled import file (CSV or XLSX)"
                accept=".csv,.xlsx"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="block w-full text-sm text-[#44474e] file:mr-3 file:rounded-[0.3rem] file:border-0 file:bg-[#edf1f5] file:px-3.5 file:py-2 file:text-sm file:font-semibold file:text-[#1d3047] hover:file:bg-[#e2e8f0] sm:w-auto"
              />
              {file ? (
                <span className="inline-flex items-center gap-1.5 text-sm text-[#5b6169]">
                  <FileSpreadsheet className="h-4 w-4 text-[#005db6]" />
                  {file.name}
                </span>
              ) : null}
            </div>

            <label className="flex items-center gap-3 text-sm text-[#44474e]">
              <Switch checked={submitOnImport} onCheckedChange={setSubmitOnImport} />
              Submit on import (otherwise saved as drafts)
            </label>

            <Button onClick={() => void runImport()} disabled={!file || isImporting} className="w-full sm:w-auto">
              {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {isImporting ? 'Importing…' : 'Import'}
            </Button>
          </div>
        </div>
      </section>

      {result ? (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={panelClass}
        >
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#1f6b3b]">
              <CheckCircle2 className="h-4 w-4" />
              {result.imported} imported
            </span>
            <span className="text-sm text-[#666970]">{result.skipped} skipped</span>
          </div>

          {result.errors.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {result.errors.map((message, index) => (
                <li
                  key={index}
                  className="flex items-start gap-2 rounded-[0.3rem] border border-[#edd9b0] bg-[#fcf5e8] px-3.5 py-2.5 text-sm text-[#8a5a00]"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{message}</span>
                </li>
              ))}
            </ul>
          ) : result.imported === 0 ? (
            <p className="mt-3 text-sm text-[#5b6169]">No rows found - check the file uses the downloaded template.</p>
          ) : null}
        </motion.section>
      ) : null}
    </div>
  )
}
