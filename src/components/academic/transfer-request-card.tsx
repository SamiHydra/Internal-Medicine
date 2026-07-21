import { useCallback, useEffect, useState } from 'react'
import { ArrowRightLeft, Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SectionHeader, panelClass } from '@/components/dashboard/section-panel'
import {
  cancelTransferRequest,
  createTransferRequest,
  fetchMyTransferRequests,
  fetchTransferOptions,
  type TransferFormOptions,
  type TransferRequestRecord,
} from '@/lib/api'
import { getApiBrowserClient } from '@/lib/api/client'
import { getErrorMessage } from '@/lib/api/helpers'

const statusVariant: Record<TransferRequestRecord['status'], 'info' | 'success' | 'danger' | 'neutral'> = {
  pending: 'info',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
}

/**
 * The consultant's section-transfer card (V2 Phase 2): request a move into
 * another section (decided by that section's head) and track or cancel own
 * requests. Rendered on the academic home page for consultants only.
 */
export function TransferRequestCard() {
  const client = getApiBrowserClient()
  const [options, setOptions] = useState<TransferFormOptions | null>(null)
  const [mine, setMine] = useState<TransferRequestRecord[]>([])
  const [toSectionId, setToSectionId] = useState('')
  const [reason, setReason] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)

  const load = useCallback(async () => {
    if (!client) {
      return
    }

    try {
      const [formOptions, myRequests] = await Promise.all([
        fetchTransferOptions(client),
        fetchMyTransferRequests(client),
      ])
      setOptions(formOptions)
      setMine(myRequests)
    } catch {
      // The card degrades to hidden rather than surfacing a load error on the
      // home page; transfers are a secondary flow there.
    } finally {
      setIsLoaded(true)
    }
  }, [client])

  useEffect(() => {
    void load()
  }, [load])

  if (!isLoaded || !options) {
    return null
  }

  const hasPending = mine.some((request) => request.status === 'pending')

  const submit = async () => {
    if (!client || !toSectionId) {
      return
    }

    setIsBusy(true)
    try {
      await createTransferRequest(client, {
        toSectionId,
        reason: reason.trim() || null,
      })
      setToSectionId('')
      setReason('')
      toast.success('Transfer request sent to the section head.')
      await load()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to file the transfer request.'))
    } finally {
      setIsBusy(false)
    }
  }

  const cancel = async (request: TransferRequestRecord) => {
    if (!client) {
      return
    }

    setIsBusy(true)
    try {
      await cancelTransferRequest(client, request.id)
      toast.success('Transfer request cancelled.')
      await load()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to cancel the request.'))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <section className={panelClass}>
      <SectionHeader
        eyebrow="Section transfer"
        title="Request a section transfer"
        description={
          options.currentSectionName
            ? `You currently belong to ${options.currentSectionName}. The head of the destination section decides; approved moves apply at the next month boundary.`
            : 'You have no section yet. Contact an administrator before requesting a transfer.'
        }
      />

      {options.currentSectionId ? (
        <div className="mt-5 flex flex-wrap items-end gap-3">
          <Select value={toSectionId} onValueChange={setToSectionId} disabled={hasPending || isBusy}>
            <SelectTrigger className="w-[230px]" aria-label="Destination section">
              <SelectValue placeholder="Destination section" />
            </SelectTrigger>
            <SelectContent>
              {options.sections.map((section) => (
                <SelectItem key={section.id} value={section.id}>
                  {section.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason (optional)"
            aria-label="Transfer reason"
            disabled={hasPending || isBusy}
            className="min-h-[40px] w-full max-w-md"
            rows={1}
          />
          <Button onClick={() => void submit()} disabled={!toSectionId || hasPending || isBusy}>
            {isBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
            Request transfer
          </Button>
          {hasPending ? (
            <p className="w-full text-[13px] text-[#74777f]">
              You already have a pending request. Cancel it below to file a new one.
            </p>
          ) : null}
        </div>
      ) : null}

      {mine.length ? (
        <div className="mt-5">
          {mine.map((request) => (
            <div
              key={request.id}
              className="flex items-center justify-between gap-3 border-b border-[#eef2f6] py-3 last:border-b-0"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <ArrowRightLeft className="h-4 w-4 shrink-0 text-[#9aa7b8]" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[#000a1e]">
                    {request.fromSectionName ?? '-'} → {request.toSectionName ?? '-'}
                  </p>
                  <p className="text-[13px] text-[#74777f]">
                    {request.status === 'approved' && request.effectiveOn
                      ? `Effective ${request.effectiveOn}`
                      : (request.reason ?? '')}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={statusVariant[request.status]}>{request.status}</Badge>
                {request.status === 'pending' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={isBusy}
                    onClick={() => void cancel(request)}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
