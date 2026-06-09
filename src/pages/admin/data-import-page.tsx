import { useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'

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
import { importReports, type ReportImportResult } from '@/lib/api/admin'
import { getApiBrowserClient } from '@/lib/api/client'
import { apiEnv } from '@/lib/api/env'
import { apiEnvSetupHint } from '@/lib/api/env'

const sectionClass =
  'rounded-[0.35rem] bg-white px-5 py-6 outline outline-1 outline-[#d4dde8] shadow-[0_24px_60px_-42px_rgba(0,33,71,0.28)] md:px-6 md:py-7'

function SectionEyebrow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className="h-3 w-[3px] rounded-full bg-[#f0b429]" />
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#005db6]">{label}</p>
    </div>
  )
}

export function DataImportPage() {
  const { state } = useAppData()
  const client = getApiBrowserClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const periods = useMemo(
    () => [...state.reportingPeriods].sort((a, b) => b.weekStart.localeCompare(a.weekStart)),
    [state.reportingPeriods],
  )
  const [periodId, setPeriodId] = useState<string>(periods[0]?.id ?? '')
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
        toast.error('No reports were imported — check the errors below.')
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to import the file.')
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={sectionClass}
      >
        <SectionEyebrow label="Offline continuity" />
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#5b6169]">
          Download a pre-filled template, fill it in Excel during an internet outage, then upload it back
          when you reconnect. Imported rows pass through the same validation as a live submission, so bad
          offline data is still caught.
        </p>
        {!apiEnv.baseUrl ? (
          <p className="mt-3 text-sm text-[#8a5a00]">The Laravel API is not configured. {apiEnvSetupHint}</p>
        ) : null}
      </motion.section>

      <section className={sectionClass}>
        <h2 className="font-display text-sm font-bold uppercase tracking-[0.16em] text-[#44474e]">
          1 · Download template
        </h2>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[#74777f]">
              Reporting period
            </label>
            <Select value={periodId} onValueChange={setPeriodId}>
              <SelectTrigger className="w-[240px]">
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
      </section>

      <section className={sectionClass}>
        <h2 className="font-display text-sm font-bold uppercase tracking-[0.16em] text-[#44474e]">
          2 · Upload filled file
        </h2>
        <div className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              ref={fileInputRef}
              type="file"
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
            Mark imported reports as submitted (otherwise they land as drafts to review)
          </label>

          <div>
            <Button onClick={() => void runImport()} disabled={!file || isImporting}>
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
          className={sectionClass}
        >
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#1f6b3b]">
              <CheckCircle2 className="h-4 w-4" />
              {result.imported} imported
            </span>
            <span className="text-sm text-[#74777f]">{result.skipped} skipped</span>
            <span className="text-sm text-[#74777f]">{result.reports} report group(s) found</span>
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
          ) : (
            <p className="mt-3 text-sm text-[#5b6169]">Every row imported cleanly.</p>
          )}
        </motion.section>
      ) : null}
    </div>
  )
}
