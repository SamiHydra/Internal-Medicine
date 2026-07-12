import { useCallback, useEffect, useState } from 'react'
import { ArrowRightLeft, Check, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
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

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

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
      toast.error(errorMessage(error, 'Unable to record the decision.'))
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
        description="Approval sits with the head of the destination section. Approved transfers apply at the next month boundary unless overridden."
        actions={
          allowImmediate ? (
            <div className="flex items-center gap-2">
              <Switch
                checked={immediate}
                aria-label="Apply approvals immediately"
                onCheckedChange={setImmediate}
              />
              <span className="text-xs font-medium text-[#44474e]">Apply immediately</span>
            </div>
          ) : undefined
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
        <div className="mt-4">
          {requests.map((request) => (
            <div
              key={request.id}
              className="flex flex-col gap-3 border-b border-[#eef2f6] py-3.5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#000a1e]">
                  {request.userName ?? 'Consultant'}
                  <span className="font-normal text-[#74777f]">
                    {' '}
                    · {request.fromSectionName ?? '-'} → {request.toSectionName ?? '-'}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-[#74777f]">
                  Requested {dateLabel(request.requestedAt) ?? '-'}
                  {request.reason ? ` · "${request.reason}"` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  disabled={busyId === request.id}
                  onClick={() => void decide(request, 'approve')}
                >
                  {busyId === request.id ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-1 h-4 w-4" />
                  )}
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busyId === request.id}
                  onClick={() => void decide(request, 'reject')}
                >
                  <X className="mr-1 h-4 w-4" />
                  Decline
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
