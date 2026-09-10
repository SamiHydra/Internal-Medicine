import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, ArrowRightLeft, Check, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  HeaderChip,
  SectionEmptyState,
  SectionHeader,
  panelClass,
} from '@/components/dashboard/section-panel'
import {
  approveTransferRequest,
  fetchTransferRequests,
  rejectTransferRequest,
  type TransferRequestRecord,
} from '@/lib/api'
import { getApiBrowserClient } from '@/lib/api/client'
import { getErrorMessage } from '@/lib/api/helpers'

function dateLabel(value: string | null) {
  if (!value) {
    return null
  }
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Pending section-transfer review queue (V2 Phase 2). Rendered for admins on
 * the academic dashboard and for section heads on their academic home; the
 * backend scopes the list (heads only see traffic touching their sections)
 * and the policy enforces who may decide. Approval defaults to the next
 * month boundary; `allowImmediate` adds the admin override.
 */
export function TransferReviewPanel({ allowImmediate = false }: { allowImmediate?: boolean }) {
  const client = getApiBrowserClient()
  const [requests, setRequests] = useState<TransferRequestRecord[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [immediate, setImmediate] = useState(false)

  const load = useCallback(async () => {
    if (!client) {
      return
    }

    try {
      setRequests(await fetchTransferRequests(client, 'pending'))
    } catch {
      setRequests([])
      toast.error('Unable to load pending transfer requests.')
    }
  }, [client])

  useEffect(() => {
    void load()
  }, [load])

  const decide = async (request: TransferRequestRecord, decision: 'approve' | 'reject') => {
    if (!client) {
      return
    }

    setBusyId(request.id)
    try {
      const updated =
        decision === 'approve'
          ? await approveTransferRequest(client, request.id, immediate ? { immediate: true } : undefined)
          : await rejectTransferRequest(client, request.id)

      setRequests((prev) => (prev ? prev.filter((item) => item.id !== request.id) : prev))
      toast.success(
        decision === 'approve'
          ? `Transfer approved${updated.effectiveOn ? `, effective ${dateLabel(updated.effectiveOn)}` : ''}.`
          : 'Transfer request declined.',
      )
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to record the decision.'))
    } finally {
      setBusyId(null)
    }
  }

  // Hidden entirely until the first load answers; an empty queue renders a
  // calm empty state only for admins (heads just see nothing extra).
  if (requests === null) {
    return null
  }

  if (requests.length === 0 && !allowImmediate) {
    return null
  }

  return (
    <section className={panelClass}>
      <SectionHeader
        eyebrow="Section transfers"
        title="Pending transfer requests"
        actions={
          <>
            {requests.length ? (
              <HeaderChip>
                {requests.length} waiting
              </HeaderChip>
            ) : null}
            {/* A switch that silently changes what the button beside it does
                needs to say so: the consequence sits under the label. */}
            {allowImmediate ? (
              <label className="flex cursor-pointer items-center gap-2.5 rounded-[0.3rem] border border-[#e6ecf3] bg-[#f8fafc] px-3 py-2">
                <Switch
                  checked={immediate}
                  aria-label="Apply approvals immediately"
                  onCheckedChange={setImmediate}
                />
                <span className="leading-tight">
                  <span className="block text-[13px] font-semibold text-[#1d3047]">
                    Apply immediately
                  </span>
                  <span className="block text-[11px] text-[#6c7177]">
                    Skip the month boundary
                  </span>
                </span>
              </label>
            ) : null}
          </>
        }
      />

      {requests.length === 0 ? (
        <div className="mt-5">
          <SectionEmptyState
            icon={<ArrowRightLeft className="h-6 w-6" />}
            title="No pending requests"
            description="Consultant transfer requests appear here as soon as they are filed."
          />
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {requests.map((request) => {
            const busy = busyId === request.id

            return (
              <article
                key={request.id}
                className="rounded-[0.4rem] border border-[#e6ecf3] bg-white p-4 transition-colors duration-200 hover:border-[#cfe0f4]"
              >
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                  <div className="min-w-0">
                    <p className="truncate font-display text-[15px] font-bold text-[#000a1e]">
                      {request.userName ?? 'Consultant'}
                    </p>
                    <p className="mt-0.5 text-xs text-[#6c7177]">
                      Requested {dateLabel(request.requestedAt) ?? '-'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void decide(request, 'reject')}
                    >
                      <X className="mr-1 h-4 w-4" />
                      Decline
                    </Button>
                    <Button size="sm" disabled={busy} onClick={() => void decide(request, 'approve')}>
                      {busy ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="mr-1 h-4 w-4" />
                      )}
                      Approve
                    </Button>
                  </div>
                </div>

                {/* The move itself is the decision, so it gets the weight the
                    consultant's name used to hold. The destination carries the
                    colour: that is the section being asked to take someone on. */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="rounded-[0.3rem] bg-[#f2f5f9] px-2.5 py-1 text-[13px] font-medium text-[#52606d]">
                    {request.fromSectionName ?? 'Unassigned'}
                  </span>
                  <ArrowRight aria-hidden className="h-4 w-4 shrink-0 text-[#9aa6b5]" />
                  <span className="rounded-[0.3rem] bg-[#edf4fb] px-2.5 py-1 text-[13px] font-semibold text-[#00468c] ring-1 ring-inset ring-[#cfe0f4]">
                    {request.toSectionName ?? 'Unassigned'}
                  </span>
                </div>

                {request.reason ? (
                  <p className="mt-3 border-l-2 border-[#e6ecf3] pl-3 text-[13px] leading-5 text-[#5f6670]">
                    {request.reason}
                  </p>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
