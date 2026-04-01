# Live Supabase Proof Artifacts

## Boundary

- This workspace does **not** contain a `.git` directory, so there is no real repository history to diff against.
- The patch files in this folder are literal patch-format artifacts generated from the current files against `/dev/null`.
- This workspace contains only [.env.example](C:/Users/Hasse/OneDrive/Desktop/Mesay/.env.example). There is no real `.env`, no hosted Supabase URL, and no anon/service-role credentials here.
- Because of that, there are **no real hosted Supabase screenshots or API logs** in this workspace. See [hosted-run-status.md](C:/Users/Hasse/OneDrive/Desktop/Mesay/artifacts/proof/hosted-run-status.md).

## Patch Files

- [src-context-app-data-context.current.patch](C:/Users/Hasse/OneDrive/Desktop/Mesay/artifacts/proof/src-context-app-data-context.current.patch)
- [src-lib-supabase-api.add.patch](C:/Users/Hasse/OneDrive/Desktop/Mesay/artifacts/proof/src-lib-supabase-api.add.patch)
- [src-lib-supabase-client.current.patch](C:/Users/Hasse/OneDrive/Desktop/Mesay/artifacts/proof/src-lib-supabase-client.current.patch)
- [supabase-live-integration.add.patch](C:/Users/Hasse/OneDrive/Desktop/Mesay/artifacts/proof/supabase-live-integration.add.patch)

## Exact Frontend Call Paths

### Login

Frontend handler: [src/pages/auth/login-page.tsx#L54](C:/Users/Hasse/OneDrive/Desktop/Mesay/src/pages/auth/login-page.tsx#L54)

```tsx
const onSubmit = form.handleSubmit(async (values) => {
  setError(null)
  const role = await login(values.email, values.password)

  if (!role) {
    setError(appError ?? 'Check your email and password and try again.')
    return
  }

  navigate(role === 'nurse' ? '/nurse' : '/admin', { replace: true })
})
```

Context call: [src/context/app-data-context.tsx#L244](C:/Users/Hasse/OneDrive/Desktop/Mesay/src/context/app-data-context.tsx#L244)

```tsx
login: async (email, password) => {
  const session = await loginWithPassword(client, email, password)
  const result = await loadUserState(session.user.id, 'Unable to load the dashboard after sign-in.')
  return result?.currentUser.role ?? null
}
```

SDK call: [src/lib/supabase/api.ts#L705](C:/Users/Hasse/OneDrive/Desktop/Mesay/src/lib/supabase/api.ts#L705)

```ts
const { data, error } = await client.auth.signInWithPassword({
  email,
  password,
})
```

### Access Request Submit

Frontend handler: [src/pages/auth/access-request-page.tsx#L70](C:/Users/Hasse/OneDrive/Desktop/Mesay/src/pages/auth/access-request-page.tsx#L70)

```tsx
const success = await submitAccessRequest({
  fullName: values.fullName,
  email: values.email,
  password: values.password,
  notes: values.notes,
  requestedAssignments: values.requestedDepartments.map((departmentId) => {
    const department = departments.find((entry) => entry.id === departmentId)!
    return {
      departmentId,
      templateId: department.templateId,
    }
  }),
})
```

Context call: [src/context/app-data-context.tsx#L295](C:/Users/Hasse/OneDrive/Desktop/Mesay/src/context/app-data-context.tsx#L295)

```tsx
submitAccessRequest: async (payload) => {
  await submitAccessRequestMutation(client, payload, currentUser)
  await refreshData()
  return true
}
```

SDK/RPC call: [src/lib/supabase/api.ts#L730](C:/Users/Hasse/OneDrive/Desktop/Mesay/src/lib/supabase/api.ts#L730)

```ts
const { data, error } = await client.auth.signUp({
  email: payload.email.toLowerCase(),
  password: payload.password,
  options: {
    data: {
      full_name: payload.fullName,
      role_key: 'nurse',
      title: 'Applicant Nurse',
    },
  },
})

const { error } = await client.rpc('submit_access_request', {
  p_user_id: requestUserId,
  p_full_name: payload.fullName,
  p_email: payload.email.toLowerCase(),
  p_requested_assignments: payload.requestedAssignments,
  p_notes: payload.notes ?? null,
})
```

### Admin Approve / Reject

Frontend handler: [src/pages/admin/user-management-page.tsx#L79](C:/Users/Hasse/OneDrive/Desktop/Mesay/src/pages/admin/user-management-page.tsx#L79)

```tsx
<Button
  variant="secondary"
  onClick={() => void approveAccessRequest(request.id, currentUser.id)}
>
  Approve
</Button>
<Button
  variant="destructive"
  onClick={() => void rejectAccessRequest(request.id, currentUser.id)}
>
  Reject
</Button>
```

Context calls: [src/context/app-data-context.tsx#L314](C:/Users/Hasse/OneDrive/Desktop/Mesay/src/context/app-data-context.tsx#L314), [src/context/app-data-context.tsx#L328](C:/Users/Hasse/OneDrive/Desktop/Mesay/src/context/app-data-context.tsx#L328)

```tsx
await reviewAccessRequestMutation(client, requestId, 'approved')
await reviewAccessRequestMutation(client, requestId, 'rejected')
```

RPC call: [src/lib/supabase/api.ts#L813](C:/Users/Hasse/OneDrive/Desktop/Mesay/src/lib/supabase/api.ts#L813)

```ts
const { error } = await client.rpc('review_access_request', {
  p_request_id: requestId,
  p_decision: decision,
})
```

### Save Draft

Frontend handler: [src/components/reports/report-form.tsx#L320](C:/Users/Hasse/OneDrive/Desktop/Mesay/src/components/reports/report-form.tsx#L320)

```tsx
const saveDraft = form.handleSubmit((values) => {
  void saveReport({
    assignmentId: assignment.id,
    reportingPeriodId: period.id,
    actorId: currentUser.id,
    values: buildPersistedValues(template, values.values),
    submit: false,
  })
})
```

Autosave path: [src/components/reports/report-form.tsx#L290](C:/Users/Hasse/OneDrive/Desktop/Mesay/src/components/reports/report-form.tsx#L290)

```tsx
void saveReport({
  assignmentId: assignment.id,
  reportingPeriodId: period.id,
  actorId: currentUser.id,
  values: buildPersistedValues(template, values.values),
  submit: false,
})
```

Context call: [src/context/app-data-context.tsx#L342](C:/Users/Hasse/OneDrive/Desktop/Mesay/src/context/app-data-context.tsx#L342)

```tsx
await saveReportMutation(client, payload)
await refreshData()
```

RPC call: [src/lib/supabase/api.ts#L782](C:/Users/Hasse/OneDrive/Desktop/Mesay/src/lib/supabase/api.ts#L782)

```ts
const { error } = await client.rpc('save_report', {
  p_assignment_id: payload.assignmentId,
  p_reporting_period_id: payload.reportingPeriodId,
  p_values: payload.values,
  p_submit: payload.submit ?? false,
})
```

### Submit Report

Frontend handler: [src/components/reports/report-form.tsx#L335](C:/Users/Hasse/OneDrive/Desktop/Mesay/src/components/reports/report-form.tsx#L335)

```tsx
const submitReport = form.handleSubmit((values) => {
  void saveReport({
    assignmentId: assignment.id,
    reportingPeriodId: period.id,
    actorId: currentUser.id,
    values: buildPersistedValues(template, values.values),
    submit: true,
  })
})
```

RPC call: same [src/lib/supabase/api.ts#L782](C:/Users/Hasse/OneDrive/Desktop/Mesay/src/lib/supabase/api.ts#L782) with `p_submit: true`.

### Lock / Unlock

Frontend handler: [src/components/reports/report-form.tsx#L393](C:/Users/Hasse/OneDrive/Desktop/Mesay/src/components/reports/report-form.tsx#L393)

```tsx
<Button
  variant="secondary"
  onClick={() => void unlockReport(report.id, currentUser.id)}
>
  Unlock report
</Button>

<Button
  variant="secondary"
  onClick={() => void lockReport(report.id, currentUser.id)}
>
  Lock report
</Button>
```

Context calls: [src/context/app-data-context.tsx#L354](C:/Users/Hasse/OneDrive/Desktop/Mesay/src/context/app-data-context.tsx#L354), [src/context/app-data-context.tsx#L366](C:/Users/Hasse/OneDrive/Desktop/Mesay/src/context/app-data-context.tsx#L366)

```tsx
await setReportLockState(client, reportId, true)
await setReportLockState(client, reportId, false)
```

RPC call: [src/lib/supabase/api.ts#L798](C:/Users/Hasse/OneDrive/Desktop/Mesay/src/lib/supabase/api.ts#L798)

```ts
const { error } = await client.rpc('set_report_lock_state', {
  p_report_id: reportId,
  p_locked: locked,
})
```

## Exact RPC Bodies

Verbatim bodies live here:

- `update_app_settings`: [supabase/migrations/202603300001_live_integration.sql#L142](C:/Users/Hasse/OneDrive/Desktop/Mesay/supabase/migrations/202603300001_live_integration.sql#L142)
- `submit_access_request`: [supabase/migrations/202603300001_live_integration.sql#L245](C:/Users/Hasse/OneDrive/Desktop/Mesay/supabase/migrations/202603300001_live_integration.sql#L245)
- `review_access_request`: [supabase/migrations/202603300001_live_integration.sql#L369](C:/Users/Hasse/OneDrive/Desktop/Mesay/supabase/migrations/202603300001_live_integration.sql#L369)
- `set_report_lock_state`: [supabase/migrations/202603300001_live_integration.sql#L478](C:/Users/Hasse/OneDrive/Desktop/Mesay/supabase/migrations/202603300001_live_integration.sql#L478)
- `save_report`: [supabase/migrations/202603300001_live_integration.sql#L629](C:/Users/Hasse/OneDrive/Desktop/Mesay/supabase/migrations/202603300001_live_integration.sql#L629)

For easier isolated reading, the exact extracted bodies are also in [rpc-bodies.sql](C:/Users/Hasse/OneDrive/Desktop/Mesay/artifacts/proof/rpc-bodies.sql).

## Sample Row Transitions

Constructed examples based on the real schema and the exact RPC logic. These are **not** captured rows from a hosted project.

See [sample-row-transitions.md](C:/Users/Hasse/OneDrive/Desktop/Mesay/artifacts/proof/sample-row-transitions.md).

## Hosted Run Proof

See [hosted-run-status.md](C:/Users/Hasse/OneDrive/Desktop/Mesay/artifacts/proof/hosted-run-status.md).

## Incomplete Items

See [incomplete-items.md](C:/Users/Hasse/OneDrive/Desktop/Mesay/artifacts/proof/incomplete-items.md).
