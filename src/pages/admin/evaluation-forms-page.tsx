import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FilePlus2,
  Loader2,
  Lock,
  Plus,
  Save,
  Send,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { AcademicWorkspaceHero } from '@/components/admin/academic-workspace-hero';
import {
  SectionEmptyState,
  panelClass,
} from '@/components/dashboard/section-panel';
import { useAppData } from '@/context/app-data-context';
import {
  createEvaluationFormDraft,
  fetchEvaluationForms,
  publishEvaluationForm,
  updateEvaluationFormContent,
  updateEvaluationFormStructure,
  type EvaluationFieldType,
  type EvaluationFormDefinition,
  type EvaluationFormField,
} from '@/lib/api/academic';
import { getApiBrowserClient } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/lib/api/helpers';

const fieldTypeOptions: Array<{ value: EvaluationFieldType; label: string }> = [
  { value: 'boolean', label: 'Yes / no' },
  { value: 'rating', label: 'Rating (1-5)' },
  { value: 'percent', label: 'Percent' },
  { value: 'integer', label: 'Whole number' },
  { value: 'time', label: 'Time' },
  { value: 'text', label: 'Text' },
  { value: 'single_select', label: 'Pick one' },
  { value: 'multi_select', label: 'Pick several' },
];

const statusVariant: Record<
  EvaluationFormDefinition['status'],
  'success' | 'info' | 'neutral'
> = {
  published: 'success',
  draft: 'info',
  archived: 'neutral',
};

/** A draft field row under structural editing. */
type DraftField = {
  key: string;
  section: string;
  label: string;
  helpText: string | null;
  type: EvaluationFieldType;
  options: EvaluationFormField['options'];
  required: boolean;
  sortOrder: number;
  active: boolean;
  isCore: boolean;
};

function toDraftFields(form: EvaluationFormDefinition): DraftField[] {
  return form.fields
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((field) => ({
      key: field.key,
      section: field.section,
      label: field.label,
      helpText: field.helpText,
      type: field.type,
      options: field.options,
      required: field.required,
      sortOrder: field.sortOrder,
      active: field.active,
      isCore: field.isCore,
    }));
}

/**
 * The evaluation form editor (V2 Phase 4). Content edits (wording, help
 * text, activation of non-core fields) apply to the published version in
 * place; structural edits (add/remove fields, change type) are Maintenance
 * only and flow through a draft that publishes as a new version, so old
 * evaluations keep rendering against the version they were answered on.
 */
export function EvaluationFormsPage() {
  const client = getApiBrowserClient();
  const { currentUser } = useAppData();
  const isSuperadmin = currentUser?.role === 'superadmin';

  const [forms, setForms] = useState<EvaluationFormDefinition[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // Content edits staged per form id: fieldKey -> {label?, helpText?}
  const [contentEdits, setContentEdits] = useState<
    Record<string, Record<string, { label?: string; helpText?: string }>>
  >({});
  // Structural drafts staged per form id.
  const [draftEdits, setDraftEdits] = useState<Record<string, DraftField[]>>(
    {},
  );

  const load = useCallback(async () => {
    if (!client) {
      setLoadError(true);
      return;
    }

    try {
      const data = await fetchEvaluationForms(client);
      setForms(data);
      setContentEdits({});
      setDraftEdits(
        Object.fromEntries(
          data
            .filter((form) => form.status === 'draft')
            .map((form) => [form.id, toDraftFields(form)]),
        ),
      );
      setLoadError(false);
    } catch {
      setLoadError(true);
      toast.error('Unable to load the evaluation forms.');
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const byKey = new Map<string, EvaluationFormDefinition[]>();
    for (const form of forms ?? []) {
      byKey.set(form.key, [...(byKey.get(form.key) ?? []), form]);
    }
    return [...byKey.entries()].map(([key, versions]) => ({
      key,
      versions: versions.sort((a, b) => b.version - a.version),
      published: versions.find((form) => form.status === 'published') ?? null,
      draft: versions.find((form) => form.status === 'draft') ?? null,
    }));
  }, [forms]);

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

  const stageContent = (
    formId: string,
    fieldKey: string,
    patch: { label?: string; helpText?: string },
  ) => {
    setContentEdits((prev) => ({
      ...prev,
      [formId]: {
        ...(prev[formId] ?? {}),
        [fieldKey]: { ...(prev[formId]?.[fieldKey] ?? {}), ...patch },
      },
    }));
  };

  const saveContent = (form: EvaluationFormDefinition) =>
    run(
      `content-${form.id}`,
      async () => {
        const staged = contentEdits[form.id] ?? {};
        await updateEvaluationFormContent(client!, form.id, {
          fields: Object.entries(staged).map(([key, patch]) => ({
            key,
            ...patch,
          })),
        });
        toast.success('Form wording saved.');
        await load();
      },
      'Unable to save the form content.',
    );

  const toggleFieldActive = (
    form: EvaluationFormDefinition,
    field: EvaluationFormField,
    active: boolean,
  ) =>
    run(
      `active-${field.id}`,
      async () => {
        await updateEvaluationFormContent(client!, form.id, {
          fields: [{ key: field.key, active }],
        });
        await load();
      },
      'Unable to update the field.',
    );

  const saveStructure = (form: EvaluationFormDefinition) =>
    run(
      `structure-${form.id}`,
      async () => {
        const fields = draftEdits[form.id] ?? [];
        await updateEvaluationFormStructure(client!, form.id, {
          fields: fields.map((field, index) => ({
            key: field.key,
            section: field.section,
            label: field.label,
            helpText: field.helpText,
            type: field.type,
            options: field.options,
            required: field.required,
            sortOrder: (index + 1) * 10,
            active: field.active,
          })),
        });
        toast.success('Draft structure saved.');
        await load();
      },
      'Unable to save the draft structure.',
    );

  if (!client || loadError) {
    return (
      <div className="px-4 py-6 md:px-8">
        <section className={panelClass}>
          <SectionEmptyState
            icon={<FilePlus2 className="h-6 w-6" />}
            title="Unable to load the evaluation forms"
            description="The form definitions could not be fetched from the API. Refresh the page to retry."
          />
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5 px-4 py-6 md:px-8">
      <AcademicWorkspaceHero
        eyebrow="Evaluation forms"
        title="Evaluation form library"
        description="Edit live wording and help text, or prepare versioned structural changes while preserving historical submissions."
        metrics={[
          {
            label: 'Forms',
            value: String(groups.length),
            note: 'Evaluation tools',
          },
          {
            label: 'Published',
            value: String(groups.filter((group) => group.published).length),
            note: 'Available to users',
          },
          {
            label: 'Drafts',
            value: String(groups.filter((group) => group.draft).length),
            note: 'Awaiting publication',
          },
          {
            label: 'Fields',
            value: String(
              groups.reduce(
                (total, group) => total + (group.published?.fields.length ?? 0),
                0,
              ),
            ),
            note: 'Published questions',
          },
        ]}
      />

      <section className={panelClass}>
        {forms === null ? (
          <div className="flex min-h-[240px] items-center justify-center text-[#74777f]">
            <Loader2
              className="h-5 w-5 animate-spin"
              aria-label="Loading forms"
            />
          </div>
        ) : (
          <div className="space-y-8">
            {groups.map((group) => (
              <div
                key={group.key}
                className="rounded-[0.4rem] border border-[#e6ecf3] p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-base font-bold text-[#000a1e]">
                      {group.published?.name ?? group.versions[0]?.name}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="text-[13px] font-medium text-[#657180]">
                        {group.key}
                      </span>
                      {group.versions.map((version) => (
                        <Badge
                          key={version.id}
                          variant={statusVariant[version.status]}
                        >
                          v{version.version} {version.status}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  {isSuperadmin && !group.draft ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy === `draft-${group.key}`}
                      onClick={() =>
                        void run(
                          `draft-${group.key}`,
                          async () => {
                            await createEvaluationFormDraft(client, group.key);
                            await load();
                          },
                          'Unable to create the draft.',
                        )
                      }
                    >
                      <FilePlus2 className="mr-1.5 h-4 w-4" /> Structural draft
                    </Button>
                  ) : null}
                </div>

                {/* ---- Published version: content editing ---- */}
                {group.published ? (
                  <div className="mt-4">
                    <div className="space-y-2.5">
                      {group.published.fields
                        .slice()
                        .sort((a, b) => a.sortOrder - b.sortOrder)
                        .map((field) => {
                          const staged =
                            contentEdits[group.published!.id]?.[field.key];
                          return (
                            <div
                              key={field.id}
                              className={cn(
                                // Three columns only from lg: at tablet width the sidebar leaves too little
                                // room for two inputs plus the badge/switch column (QA-012 sweep).
                                'grid gap-2.5 rounded-[0.3rem] border border-[#eef2f6] px-3.5 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]',
                                staged && 'border-[#005db6] bg-[#f4f9ff]',
                                !field.active && 'opacity-60',
                              )}
                            >
                              <div className="min-w-0 space-y-1">
                                <Input
                                  value={staged?.label ?? field.label}
                                  aria-label={`Label for ${field.key}`}
                                  onChange={(event) =>
                                    stageContent(
                                      group.published!.id,
                                      field.key,
                                      { label: event.target.value },
                                    )
                                  }
                                />
                                <p className="truncate text-[13px] leading-5 text-[#5f6670]">
                                  {field.key} · {field.section} ·{' '}
                                  {fieldTypeOptions.find(
                                    (option) => option.value === field.type,
                                  )?.label ?? field.type}
                                </p>
                              </div>
                              <Input
                                value={staged?.helpText ?? field.helpText ?? ''}
                                placeholder="Help text"
                                aria-label={`Help text for ${field.key}`}
                                onChange={(event) =>
                                  stageContent(group.published!.id, field.key, {
                                    helpText: event.target.value,
                                  })
                                }
                              />
                              <div className="flex flex-wrap items-center gap-2.5 lg:justify-self-end">
                                {field.isCore ? (
                                  <Badge variant="warning">
                                    <Lock className="mr-1 h-3 w-3" /> Core
                                  </Badge>
                                ) : (
                                  <Switch
                                    checked={field.active}
                                    disabled={busy === `active-${field.id}`}
                                    aria-label={`Toggle ${field.key} active`}
                                    onCheckedChange={(active) =>
                                      void toggleFieldActive(
                                        group.published!,
                                        field,
                                        active,
                                      )
                                    }
                                  />
                                )}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                    <div className="mt-3 flex justify-end">
                      <Button
                        size="sm"
                        disabled={
                          !contentEdits[group.published.id] ||
                          busy === `content-${group.published.id}`
                        }
                        onClick={() => void saveContent(group.published!)}
                      >
                        <Save className="mr-1.5 h-4 w-4" /> Save wording
                      </Button>
                    </div>
                  </div>
                ) : null}

                {/* ---- Draft version: structural editing (Maintenance only) ---- */}
                {group.draft && isSuperadmin ? (
                  <div className="mt-5 rounded-[0.35rem] border border-dashed border-[#7cb3ff] bg-[#f8fbff] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#005db6]">
                      Draft v{group.draft.version} · structural editor
                    </p>
                    <div className="mt-3 space-y-2">
                      {(draftEdits[group.draft.id] ?? []).map(
                        (field, index) => (
                          <div
                            key={`${group.draft!.id}-${index}`}
                            // Six columns only from lg: beside the sidebar a tablet leaves ~350px, which
                            // the fixed key/type columns plus two switches cannot share (QA-012 sweep).
                            className="grid gap-2 lg:grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)_130px_auto_auto]"
                          >
                            <Input
                              value={field.key}
                              disabled={field.isCore}
                              aria-label="Field key"
                              placeholder="field_key"
                              onChange={(event) =>
                                setDraftEdits((prev) => ({
                                  ...prev,
                                  [group.draft!.id]: prev[group.draft!.id].map(
                                    (entry, i) =>
                                      i === index
                                        ? {
                                            ...entry,
                                            key: event.target.value.replace(
                                              /[^a-z0-9_]/g,
                                              '',
                                            ),
                                          }
                                        : entry,
                                  ),
                                }))
                              }
                            />
                            <Input
                              value={field.section}
                              aria-label="Section"
                              placeholder="Section"
                              onChange={(event) =>
                                setDraftEdits((prev) => ({
                                  ...prev,
                                  [group.draft!.id]: prev[group.draft!.id].map(
                                    (entry, i) =>
                                      i === index
                                        ? {
                                            ...entry,
                                            section: event.target.value,
                                          }
                                        : entry,
                                  ),
                                }))
                              }
                            />
                            <Input
                              value={field.label}
                              aria-label="Label"
                              placeholder="Label"
                              onChange={(event) =>
                                setDraftEdits((prev) => ({
                                  ...prev,
                                  [group.draft!.id]: prev[group.draft!.id].map(
                                    (entry, i) =>
                                      i === index
                                        ? {
                                            ...entry,
                                            label: event.target.value,
                                          }
                                        : entry,
                                  ),
                                }))
                              }
                            />
                            <Select
                              value={field.type}
                              disabled={field.isCore}
                              onValueChange={(type) =>
                                setDraftEdits((prev) => ({
                                  ...prev,
                                  [group.draft!.id]: prev[group.draft!.id].map(
                                    (entry, i) =>
                                      i === index
                                        ? {
                                            ...entry,
                                            type: type as EvaluationFieldType,
                                          }
                                        : entry,
                                  ),
                                }))
                              }
                            >
                              <SelectTrigger aria-label="Field type">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {fieldTypeOptions.map((option) => (
                                  <SelectItem
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <div className="flex items-center gap-1.5">
                              <Switch
                                checked={field.required}
                                aria-label="Required"
                                onCheckedChange={(required) =>
                                  setDraftEdits((prev) => ({
                                    ...prev,
                                    [group.draft!.id]: prev[
                                      group.draft!.id
                                    ].map((entry, i) =>
                                      i === index
                                        ? { ...entry, required }
                                        : entry,
                                    ),
                                  }))
                                }
                              />
                              <span className="text-xs font-semibold text-[#657180]">
                                req
                              </span>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={field.isCore}
                              aria-label={`Remove ${field.key}`}
                              onClick={() =>
                                setDraftEdits((prev) => ({
                                  ...prev,
                                  [group.draft!.id]: prev[
                                    group.draft!.id
                                  ].filter((_, i) => i !== index),
                                }))
                              }
                            >
                              {field.isCore ? (
                                <Lock className="h-4 w-4 text-[#9aa7b8]" />
                              ) : (
                                <Trash2 className="h-4 w-4 text-[#ba1a1a]" />
                              )}
                            </Button>
                          </div>
                        ),
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap justify-between gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          setDraftEdits((prev) => ({
                            ...prev,
                            [group.draft!.id]: [
                              ...(prev[group.draft!.id] ?? []),
                              {
                                key: '',
                                section: 'New section',
                                label: '',
                                helpText: null,
                                type: 'boolean',
                                options: null,
                                required: false,
                                sortOrder:
                                  ((prev[group.draft!.id]?.length ?? 0) + 1) *
                                  10,
                                active: true,
                                isCore: false,
                              },
                            ],
                          }))
                        }
                      >
                        <Plus className="mr-1.5 h-4 w-4" /> Add field
                      </Button>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy === `structure-${group.draft.id}`}
                          onClick={() => void saveStructure(group.draft!)}
                        >
                          <Save className="mr-1.5 h-4 w-4" /> Save draft
                        </Button>
                        <Button
                          size="sm"
                          disabled={busy === `publish-${group.draft.id}`}
                          onClick={() =>
                            void run(
                              `publish-${group.draft!.id}`,
                              async () => {
                                await publishEvaluationForm(
                                  client,
                                  group.draft!.id,
                                );
                                toast.success(
                                  `Version ${group.draft!.version} published.`,
                                );
                                await load();
                              },
                              'Unable to publish the draft.',
                            )
                          }
                        >
                          <Send className="mr-1.5 h-4 w-4" /> Publish v
                          {group.draft.version}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
