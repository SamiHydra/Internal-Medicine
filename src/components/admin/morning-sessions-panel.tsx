import { useCallback, useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Clock3, Plus, Save, Sunrise, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  SectionHeader,
  panelClass,
} from "@/components/dashboard/section-panel";
import { useAppData } from "@/context/app-data-context";
import {
  cancelMorningSession,
  createMorningOverride,
  deleteMorningOverride,
  fetchMorningConfig,
  fetchMorningOverrides,
  fetchMorningSessions,
  updateMorningRecorders,
  updateMorningSessionTime,
  type MorningRosterOverrideRecord,
  type MorningSessionRecord,
} from "@/lib/api/morning";
import { getApiBrowserClient } from "@/lib/api/client";
import { getErrorMessage } from "@/lib/api/helpers";

const statusVariant: Record<
  MorningSessionRecord["status"],
  "info" | "success" | "neutral"
> = {
  pending: "info",
  recorded: "success",
  cancelled: "neutral",
};

function formatSessionDate(value: string) {
  const parsed = parseISO(value);

  return Number.isNaN(parsed.getTime()) ? value : format(parsed, "EEE, MMM d, yyyy");
}

/**
 * Admin oversight of morning sessions (V2 Phase 6): the recent log
 * (punctuality, attendance counts, not-recorded and cancelled sessions),
 * cancellation with a reason, the designated recorders, and the roster
 * include/exclude overrides.
 */
export function MorningSessionsPanel() {
  const client = getApiBrowserClient();
  const { state, ensureProfileDirectoryData } = useAppData();

  const [sessions, setSessions] = useState<MorningSessionRecord[] | null>(null);
  const [overrides, setOverrides] = useState<MorningRosterOverrideRecord[]>([]);
  const [recorderIds, setRecorderIds] = useState<string[]>([]);
  const [sessionTime, setSessionTime] = useState("08:00");
  const [savedSessionTime, setSavedSessionTime] = useState("08:00");
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelDraft, setCancelDraft] = useState({ sessionId: "", reason: "" });
  const [overrideDraft, setOverrideDraft] = useState({
    userId: "",
    action: "exclude" as "include" | "exclude",
    startsOn: "",
    endsOn: "",
  });
  const [newRecorderId, setNewRecorderId] = useState("");

  const load = useCallback(async () => {
    if (!client) {
      setSessions([]);
      return;
    }

    try {
      const [sessionData, overrideData, config] = await Promise.all([
        fetchMorningSessions(client),
        fetchMorningOverrides(client),
        fetchMorningConfig(client),
      ]);
      setSessions(sessionData);
      setOverrides(overrideData);
      setRecorderIds(config.morningRecorderIds);
      setSessionTime(config.morningSessionTime);
      setSavedSessionTime(config.morningSessionTime);
    } catch {
      setSessions([]);
      toast.error("Unable to load the morning sessions.");
    }
  }, [client]);

  useEffect(() => {
    void load();
    void ensureProfileDirectoryData();
  }, [load, ensureProfileDirectoryData]);

  const academicPeople = useMemo(
    () =>
      state.profiles
        .filter(
          (profile) =>
            (profile.role === "resident" || profile.role === "consultant") &&
            profile.active,
        )
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [state.profiles],
  );

  const nameFor = (userId: string) =>
    state.profiles.find((profile) => profile.id === userId)?.fullName ?? userId;

  const run = async (
    key: string,
    action: () => Promise<void>,
    failure: string,
  ) => {
    if (!client) {
      return;
    }
    setBusy(key);
    try {
      await action();
    } catch (error) {
      toast.error(getErrorMessage(error, failure));
    } finally {
      setBusy(null);
    }
  };

  if (sessions === null) {
    return null;
  }

  return (
    <section className={panelClass}>
      <SectionHeader
        eyebrow="Morning sessions"
        title="Punctuality & attendance log"
        description="One department-wide session on the configured days, measured against the fixed start. A pending past session means it was never recorded - a signal, not an error."
      />

      {/* ---- Schedule ---- */}
      <form
        className="mt-5 rounded-[0.4rem] border border-[#dbe7f3] bg-[#f3f8fd] p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            "session-time",
            async () => {
              await updateMorningSessionTime(client!, sessionTime);
              setSavedSessionTime(sessionTime);
              toast.success("Morning-session start time updated.");
            },
            "Unable to update the morning-session start time.",
          );
        }}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-xl space-y-1.5">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-[#005db6]" />
              <Label htmlFor="morning-session-time">Scheduled start time</Label>
            </div>
            <p className="text-sm text-[#5f6670]">
              Sets the punctuality baseline and reminder timing for future sessions.
              Existing session records keep their original scheduled time.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              id="morning-session-time"
              type="time"
              required
              value={sessionTime}
              className="h-10 w-[8.5rem] bg-white px-3 tabular-nums"
              onChange={(event) => setSessionTime(event.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              className="shrink-0 whitespace-nowrap"
              disabled={
                !sessionTime ||
                sessionTime === savedSessionTime ||
                busy === "session-time"
              }
            >
              <Save className="mr-1 h-4 w-4" />
              {busy === "session-time" ? "Saving…" : "Save time"}
            </Button>
          </div>
        </div>
      </form>

      {/* ---- Recorders ---- */}
      <div className="mt-5 rounded-[0.4rem] border border-[#e6ecf3] bg-[#f8fafc] p-4">
        <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#526171]">
          Designated recorders
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {recorderIds.length === 0 ? (
            <p className="text-sm text-[#74777f]">
              Nobody is designated yet: appoint one standing recorder below.
            </p>
          ) : (
            recorderIds.map((recorderId) => (
              <span
                key={recorderId}
                className="inline-flex h-10 items-center gap-2 rounded-[0.3rem] border border-[#d4dde8] bg-white px-3 text-sm font-semibold text-[#1d3047]"
              >
                {nameFor(recorderId)}
                <button
                  type="button"
                  aria-label={`Remove recorder ${nameFor(recorderId)}`}
                  className="rounded-sm text-[#ba1a1a] transition-colors hover:bg-[#fff1f1] hover:text-[#7f1212] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ba1a1a]/25"
                  onClick={() =>
                    void run(
                      "recorders",
                      async () => {
                        const next = recorderIds.filter(
                          (id) => id !== recorderId,
                        );
                        await updateMorningRecorders(client!, next);
                        setRecorderIds(next);
                      },
                      "Unable to update the recorders.",
                    )
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))
          )}
          <Select value={newRecorderId} onValueChange={setNewRecorderId}>
            <SelectTrigger className="h-10 w-full text-sm sm:w-[18rem]" aria-label="Add recorder">
              <SelectValue placeholder="Add a recorder" />
            </SelectTrigger>
            <SelectContent>
              {academicPeople
                .filter((person) => !recorderIds.includes(person.id))
                .map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.fullName}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="secondary"
            className="h-10 px-4 text-sm"
            disabled={!newRecorderId || busy === "recorders"}
            onClick={() =>
              void run(
                "recorders",
                async () => {
                  const next = [...recorderIds, newRecorderId];
                  await updateMorningRecorders(client!, next);
                  setRecorderIds(next);
                  setNewRecorderId("");
                },
                "Unable to update the recorders.",
              )
            }
          >
            <Plus className="mr-1 h-4 w-4" /> Appoint
          </Button>
        </div>
      </div>

      {/* ---- Roster overrides ---- */}
      <div className="mt-4 rounded-[0.4rem] border border-[#e6ecf3] bg-[#f8fafc] p-4">
        <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#526171]">
          Roster overrides
        </p>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-[minmax(11rem,1fr)_minmax(13rem,1.15fr)_minmax(10.5rem,1fr)_minmax(10.5rem,1fr)_auto]">
          <Select
            value={overrideDraft.userId}
            onValueChange={(userId) =>
              setOverrideDraft((prev) => ({ ...prev, userId }))
            }
          >
            <SelectTrigger className="h-10 text-sm" aria-label="Override person">
              <SelectValue placeholder="Person" />
            </SelectTrigger>
            <SelectContent>
              {academicPeople.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {person.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={overrideDraft.action}
            onValueChange={(action) =>
              setOverrideDraft((prev) => ({
                ...prev,
                action: action as "include" | "exclude",
              }))
            }
          >
            <SelectTrigger className="h-10 text-sm" aria-label="Override action">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="exclude">Exclude from roster</SelectItem>
              <SelectItem value="include">Include on roster</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={overrideDraft.startsOn}
            aria-label="Override from"
            className="h-10 text-sm"
            onChange={(event) =>
              setOverrideDraft((prev) => ({
                ...prev,
                startsOn: event.target.value,
              }))
            }
          />
          <Input
            type="date"
            value={overrideDraft.endsOn}
            aria-label="Override until (optional)"
            className="h-10 text-sm"
            onChange={(event) =>
              setOverrideDraft((prev) => ({
                ...prev,
                endsOn: event.target.value,
              }))
            }
          />
          <Button
            size="sm"
            className="h-10 min-w-[7.5rem] px-4 text-sm"
            disabled={
              !overrideDraft.userId ||
              !overrideDraft.startsOn ||
              busy === "override-create"
            }
            onClick={() =>
              void run(
                "override-create",
                async () => {
                  await createMorningOverride(client!, {
                    userId: overrideDraft.userId,
                    action: overrideDraft.action,
                    startsOn: overrideDraft.startsOn,
                    endsOn: overrideDraft.endsOn || null,
                  });
                  setOverrideDraft({
                    userId: "",
                    action: "exclude",
                    startsOn: "",
                    endsOn: "",
                  });
                  await load();
                },
                "Unable to save the override.",
              )
            }
          >
            <Plus className="mr-1 h-4 w-4" /> Add
          </Button>
        </div>
        {overrides.length ? (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {overrides.map((override) => (
              <span
                key={override.id}
                className="inline-flex items-center gap-1.5 rounded-[0.25rem] border border-[#d4dde8] bg-white px-2.5 py-1 text-[13px] font-medium text-[#44474e]"
              >
                {override.action === "exclude" ? "−" : "+"} {override.userName}{" "}
                · {override.startsOn}
                {override.endsOn ? ` to ${override.endsOn}` : " onward"}
                <button
                  type="button"
                  aria-label={`Remove override for ${override.userName}`}
                  className="text-[#ba1a1a] hover:text-[#7f1212]"
                  onClick={() =>
                    void run(
                      `override-${override.id}`,
                      async () => {
                        await deleteMorningOverride(client!, override.id);
                        await load();
                      },
                      "Unable to remove the override.",
                    )
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* ---- Session log ---- */}
      {sessions.length === 0 ? (
        <p className="mt-5 flex items-center gap-2 text-sm text-[#74777f]">
          <Sunrise className="h-4 w-4" /> No morning sessions yet: the first
          opens automatically on the next configured day.
        </p>
      ) : (
        <div className="mt-6 border-t border-[#e6ecf3] pt-5">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <p className="text-[13px] font-bold uppercase tracking-[0.16em] text-[#005b9f]">
                Session history
              </p>
              <p className="mt-1.5 text-sm leading-5 text-[#5f6670]">
                Review recent records without leaving this workspace.
              </p>
            </div>
            <p className="shrink-0 pb-0.5 text-sm font-semibold tabular-nums text-[#45566a]">
              {sessions.length} total
            </p>
          </div>
          <div
            className="max-h-[34rem] overflow-y-auto overscroll-contain border-y border-[#e6ecf3] outline-none focus-visible:ring-2 focus-visible:ring-[#005db6]/25"
            role="region"
            aria-label="Morning session history"
            tabIndex={0}
          >
            {sessions.map((session) => (
              <article
                key={session.id}
                className="border-b border-[#e9eef4] px-2 py-3.5 transition-colors duration-150 hover:bg-[#f8fafc] last:border-b-0 sm:px-1"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <time
                        dateTime={session.sessionDate}
                        title={session.sessionDate}
                        className="text-[15px] font-semibold tracking-[-0.01em] text-[#000a1e]"
                      >
                        {formatSessionDate(session.sessionDate)}
                      </time>
                      <span className="text-sm font-medium tabular-nums text-[#566474]">
                        Scheduled {session.scheduledStartAt}
                      </span>
                      {session.status === "recorded" ? (
                        <span
                          className={
                            session.startedOnTime
                              ? "text-sm font-semibold text-[#237346]"
                              : "text-sm font-semibold text-[#8a5a00]"
                          }
                        >
                          {session.startedOnTime
                            ? "On time"
                            : `${session.delayMinutes} min late · started ${session.actualStartAt}`}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm leading-5 text-[#657180]">
                      {session.status === "recorded" ? (
                        <>
                          <span className="font-semibold text-[#34465a]">
                            {session.presentCount} of {session.attendanceCount} present
                          </span>
                          <span className="mx-1.5 text-[#a0a9b4]" aria-hidden="true">·</span>
                          Recorded by {session.recordedByName ?? "-"}
                        </>
                      ) : session.status === "cancelled" ? (
                        session.reason ?? "Cancelled"
                      ) : (
                        <span className="font-medium text-[#7a4f00]">Attendance not recorded</span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center justify-between gap-2 sm:min-w-[12rem] sm:justify-end">
                    <Badge
                      variant={statusVariant[session.status]}
                      className="min-w-[6.75rem] justify-center text-[11px]"
                    >
                      {session.status}
                    </Badge>
                    {session.status === "pending" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 px-2.5 text-sm"
                        onClick={() =>
                          setCancelDraft({ sessionId: session.id, reason: "" })
                        }
                      >
                        <X className="mr-1 h-4 w-4 text-[#ba1a1a]" /> Cancel
                      </Button>
                    ) : null}
                  </div>
                </div>

                {cancelDraft.sessionId === session.id ? (
                  <div className="mt-2.5 flex flex-wrap items-end gap-2">
                    <Textarea
                      value={cancelDraft.reason}
                      placeholder="Why is it cancelled? (holiday, ...)"
                      aria-label="Cancellation reason"
                      className="min-h-[44px] w-full max-w-md"
                      rows={1}
                      onChange={(event) =>
                        setCancelDraft((prev) => ({
                          ...prev,
                          reason: event.target.value,
                        }))
                      }
                    />
                    <Button
                      size="sm"
                      disabled={
                        !cancelDraft.reason.trim() ||
                        busy === `cancel-${session.id}`
                      }
                      onClick={() =>
                        void run(
                          `cancel-${session.id}`,
                          async () => {
                            await cancelMorningSession(
                              client!,
                              session.id,
                              cancelDraft.reason.trim(),
                            );
                            setCancelDraft({ sessionId: "", reason: "" });
                            toast.success("Session cancelled.");
                            await load();
                          },
                          "Unable to cancel the session.",
                        )
                      }
                    >
                      Confirm cancel
                    </Button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
