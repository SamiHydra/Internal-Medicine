import { useCallback, useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  ArrowRight,
  Clock3,
  MinusCircle,
  Plus,
  PlusCircle,
  Save,
  Sunrise,
  TriangleAlert,
  X,
} from "lucide-react";
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
import { cn } from "@/lib/utils";

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

/** Override dates arrive as ISO days; nobody reads "2026-09-01" as a date. */
function formatDay(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = parseISO(value);

  return Number.isNaN(parsed.getTime()) ? value : format(parsed, "d MMM yyyy");
}

function initialsOf(name: string) {
  return name
    .split(" ")
    .filter((part) => !part.endsWith("."))
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** Shared shell for the two settings blocks, so both read as one system. */
function SettingsBlock({
  title,
  hint,
  count,
  children,
}: {
  title: string;
  hint: string;
  count?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 rounded-[0.4rem] border border-[#e6ecf3] bg-[#f8fafc] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#526171]">
          {title}
        </p>
        {count ? (
          <p className="text-[12px] font-semibold tabular-nums text-[#8b9199]">{count}</p>
        ) : null}
      </div>
      <p className="mt-1 text-[13px] leading-5 text-[#74777f]">{hint}</p>
      {children}
    </div>
  );
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

      {/* ---- Recorders ----
          Who is appointed and the control that appoints them used to sit in one
          flex row, so the list and the form were indistinguishable and the
          dropdown moved as people were added. They are separated now. */}
      <SettingsBlock
        title="Designated recorders"
        hint="They open the morning session and mark who attended. Nobody else can."
        count={
          recorderIds.length
            ? `${recorderIds.length} appointed`
            : undefined
        }
      >
        {recorderIds.length === 0 ? (
          <p className="mt-3 flex items-start gap-2 rounded-[0.3rem] border border-[#f0d9aa] bg-[#fdf7ec] px-3 py-2.5 text-[13px] leading-5 text-[#7a4f00]">
            <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            No one is appointed, so attendance cannot be recorded. Appoint someone below.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[#eef2f6] rounded-[0.3rem] border border-[#e6ecf3] bg-white">
            {recorderIds.map((recorderId) => (
              <li key={recorderId} className="flex items-center gap-3 px-3 py-2">
                <span
                  aria-hidden
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#04162f] text-[10px] font-bold text-[#f0b429]"
                >
                  {initialsOf(nameFor(recorderId))}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#1d3047]">
                  {nameFor(recorderId)}
                </span>
                {/* A bare red cross beside the only person who can record
                    attendance was one misclick away from a silent outage. */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 px-2 text-[13px] text-[#ba1a1a] hover:bg-[#fff1f1]"
                  disabled={busy === "recorders"}
                  onClick={() =>
                    void run(
                      "recorders",
                      async () => {
                        const next = recorderIds.filter((id) => id !== recorderId);
                        await updateMorningRecorders(client!, next);
                        setRecorderIds(next);
                        toast.success(`${nameFor(recorderId)} is no longer a recorder.`);
                      },
                      "Unable to update the recorders.",
                    )
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select value={newRecorderId} onValueChange={setNewRecorderId}>
            <SelectTrigger
              className="h-10 w-full bg-white text-sm sm:w-[18rem]"
              aria-label="Add recorder"
            >
              <SelectValue placeholder="Choose someone" />
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
                  toast.success("Recorder appointed.");
                },
                "Unable to update the recorders.",
              )
            }
          >
            <Plus className="mr-1 h-4 w-4" /> Appoint
          </Button>
        </div>
      </SettingsBlock>

      {/* ---- Roster overrides ----
          Four unlabelled controls, two of them identical date boxes, gave no
          way to tell "from" from "until" or to know that "until" is optional.
          The rules they produce now read as sentences rather than as
          "− Name · 2026-09-01 to 2026-09-30". */}
      <SettingsBlock
        title="Roster overrides"
        hint="Add or drop one person from the morning roster for a period. Everyone else follows the standard roster."
        count={overrides.length ? `${overrides.length} active` : undefined}
      >
        <div className="mt-3 grid gap-x-3 gap-y-3 sm:grid-cols-2 xl:grid-cols-[minmax(10rem,1fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_auto]">
          <label className="space-y-1.5">
            <Label>Person</Label>
            <Select
              value={overrideDraft.userId}
              onValueChange={(userId) =>
                setOverrideDraft((prev) => ({ ...prev, userId }))
              }
            >
              <SelectTrigger className="h-10 bg-white text-sm" aria-label="Override person">
                <SelectValue placeholder="Choose someone" />
              </SelectTrigger>
              <SelectContent>
                {academicPeople.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-1.5">
            <Label>Change</Label>
            <Select
              value={overrideDraft.action}
              onValueChange={(action) =>
                setOverrideDraft((prev) => ({
                  ...prev,
                  action: action as "include" | "exclude",
                }))
              }
            >
              <SelectTrigger className="h-10 bg-white text-sm" aria-label="Override action">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="exclude">Drop from roster</SelectItem>
                <SelectItem value="include">Add to roster</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-1.5">
            <Label>From</Label>
            <Input
              type="date"
              value={overrideDraft.startsOn}
              aria-label="Override from"
              className="h-10 bg-white text-sm"
              onChange={(event) =>
                setOverrideDraft((prev) => ({
                  ...prev,
                  startsOn: event.target.value,
                }))
              }
            />
          </label>
          <label className="space-y-1.5">
            <Label>
              Until <span className="font-normal text-[#9aa6b5]">optional</span>
            </Label>
            <Input
              type="date"
              value={overrideDraft.endsOn}
              min={overrideDraft.startsOn || undefined}
              aria-label="Override until (optional)"
              className="h-10 bg-white text-sm"
              onChange={(event) =>
                setOverrideDraft((prev) => ({
                  ...prev,
                  endsOn: event.target.value,
                }))
              }
            />
          </label>
          <Button
            size="sm"
            className="h-10 min-w-[7.5rem] px-4 text-sm xl:self-end"
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
                  toast.success("Override saved.");
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
          <ul className="mt-3 divide-y divide-[#eef2f6] rounded-[0.3rem] border border-[#e6ecf3] bg-white">
            {overrides.map((override) => {
              const dropped = override.action === "exclude";
              const Icon = dropped ? MinusCircle : PlusCircle;

              return (
                <li key={override.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <Icon
                    aria-hidden
                    className={cn(
                      "h-4 w-4 shrink-0",
                      dropped ? "text-[#ba1a1a]" : "text-[#1f9254]",
                    )}
                  />
                  <span className="min-w-0 flex-1 text-[13px] leading-5 text-[#52606d]">
                    <span className="font-semibold text-[#1d3047]">{override.userName}</span>
                    {dropped ? " is off the roster" : " is on the roster"}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-[13px] tabular-nums text-[#52606d]">
                    {formatDay(override.startsOn)}
                    <ArrowRight aria-hidden className="h-3 w-3 text-[#c0c8d2]" />
                    {formatDay(override.endsOn) ?? (
                      <span className="text-[#8b9199]">no end</span>
                    )}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 px-2 text-[13px] text-[#ba1a1a] hover:bg-[#fff1f1]"
                    disabled={busy === `override-${override.id}`}
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
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 rounded-[0.3rem] border border-dashed border-[#dbe3ec] bg-white px-3 py-2.5 text-[13px] text-[#74777f]">
            No overrides. Everyone follows the standard roster.
          </p>
        )}
      </SettingsBlock>

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
