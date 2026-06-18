import { useCallback, useEffect, useState } from 'react'
import { Loader2, MessageSquare, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { getApiBrowserClient } from '@/lib/api/client'
import {
  deleteReportComment,
  fetchReportComments,
  postReportComment,
} from '@/lib/api/reports'
import type { ReportComment } from '@/lib/api/types'
import { formatTimestamp } from '@/lib/dates'

const panelClass =
  'rounded-[0.35rem] bg-white px-5 py-6 outline outline-1 outline-[#d4dde8] shadow-[0_24px_60px_-42px_rgba(0,33,71,0.28)] md:px-6 md:py-7'

const adminRoles = new Set(['admin', 'superadmin'])

export function ReportComments({
  reportId,
  currentUserId,
  currentUserRole,
}: {
  reportId: string
  currentUserId: string
  currentUserRole: string
}) {
  const client = getApiBrowserClient()
  const [comments, setComments] = useState<ReportComment[]>([])
  const [isLoading, setIsLoading] = useState(Boolean(client))
  const [body, setBody] = useState('')
  const [isPosting, setIsPosting] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const isAdmin = adminRoles.has(currentUserRole)

  const load = useCallback(() => {
    if (!client) {
      return
    }

    setIsLoading(true)
    fetchReportComments(client, reportId)
      .then(setComments)
      .catch(() => {
        // Comments are non-critical context; never block the report on a fetch error.
      })
      .finally(() => setIsLoading(false))
  }, [client, reportId])

  useEffect(() => {
    load()
  }, [load])

  const submit = async () => {
    const trimmed = body.trim()
    if (!client || !trimmed) {
      return
    }

    setIsPosting(true)
    try {
      const created = await postReportComment(client, reportId, trimmed)
      setComments((previous) => [...previous, created])
      setBody('')
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to post the comment.')
    } finally {
      setIsPosting(false)
    }
  }

  const remove = async (comment: ReportComment) => {
    if (!client) {
      return
    }

    setPendingDelete(comment.id)
    try {
      await deleteReportComment(client, reportId, comment.id)
      setComments((previous) => previous.filter((entry) => entry.id !== comment.id))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to delete the comment.')
    } finally {
      setPendingDelete(null)
    }
  }

  return (
    <section className={panelClass}>
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-[#005db6]" />
        <h2 className="font-display text-xs font-bold uppercase tracking-[0.16em] text-[#44474e]">Discussion</h2>
        <span className="rounded-full bg-[#edf1f5] px-2 py-0.5 text-[11px] font-semibold text-[#44474e]">
          {comments.length}
        </span>
      </div>

      {isLoading ? (
        <p className="mt-4 text-sm text-[#74777f]">Loading comments…</p>
      ) : comments.length === 0 ? (
        <p className="mt-4 text-sm text-[#74777f]">
          No comments yet. Ask a question or add context about this report instead of using a side channel.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {comments.map((comment) => (
            <li
              key={comment.id}
              className="rounded-[0.3rem] border border-[#e6ecf3] bg-[#f8fafc] px-3.5 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#000a1e]">
                    <span>{comment.authorName}</span>
                    {comment.authorRole ? (
                      <span className="ml-2 text-[11px] font-medium uppercase tracking-[0.1em] text-[#74777f]">
                        <span aria-hidden className="mr-1.5 text-[#c2c8d0]">·</span>
                        {comment.authorRole}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#3a3f47]">{comment.body}</p>
                  <p className="mt-1 text-xs text-[#9aa0a8]">
                    {comment.createdAt ? formatTimestamp(comment.createdAt) : ''}
                  </p>
                </div>
                {isAdmin || comment.authorId === currentUserId ? (
                  <button
                    type="button"
                    onClick={() => void remove(comment)}
                    disabled={pendingDelete === comment.id}
                    aria-label="Delete comment"
                    className="shrink-0 rounded p-1 text-[#9aa0a8] transition-colors hover:text-[#ba1a1a]"
                  >
                    {pendingDelete === comment.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 space-y-2">
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Add a comment…"
          className="min-h-20"
        />
        <div className="flex justify-end">
          <Button onClick={() => void submit()} disabled={isPosting || !body.trim()}>
            {isPosting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Comment
          </Button>
        </div>
      </div>
    </section>
  )
}
