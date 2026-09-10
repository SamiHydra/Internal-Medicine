# Accessibility audit

Automated and keyboard/visual accessibility audit of the reporting platform,
run against the isolated local gate (Vite dev server plus `php artisan serve`
on the seeded SQLite fixture), with every legitimate critical and serious
finding fixed and re-measured. Status date: 2026-09-09.

The audit is opt-in and separate from the merge gate (which keeps its own
critical-only axe check in `accessibility.spec.ts`):

```
E2E_A11Y=1 npm run test:e2e
```

Specs: `tests/e2e/a11y-sweep.spec.ts` (axe-core 4.11 over every route and
state for every role at 1280 px and 390 px), `tests/e2e/a11y-keyboard.spec.ts`
(keyboard-only flows with a focus-order, name and focus-indicator audit),
`tests/e2e/a11y-visual.spec.ts` (200 % zoom, large text, reduced motion,
forced colours, touch targets). Outputs: `output/a11y/` (per-role axe JSON,
`summary.md`, keyboard records, screenshots).

Standard: WCAG 2.2 AA rules as implemented by axe-core (tags `wcag2a`,
`wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, `best-practice`).

## 1. Before and after

Axe sweep, 78 page states (anonymous, nurse, resident, consultant, group
representative, superadmin; two viewports each). A "violation" is one rule on
one page state; "nodes" are the elements it flagged.

| Impact | Before: violations / nodes | After: violations / nodes |
|---|---:|---:|
| Critical | 11 / 90 | 0 / 0 |
| Serious | 71 / 1,664 | 0 / 0 |
| Moderate | 9 / 9 | 0 / 0 |
| Minor | 2 / 2 | 0 / 0 |

Keyboard and visual specs: before 28 passed / 20 failed (48 tests); after
48 passed / 0 failed.

Both "after" figures are the full audit re-run on the fixed tree (run 4,
9.2 minutes, 48 of 48 tests passed). Intermediate runs: run 2 after the colour and markup fixes
(axe 4 violations / 4 nodes, 16 spec failures left), run 3 after the second
patch (axe 0 / 0, 3 spec failures left).

## 2. Findings

Status: **FIXED** (change made, re-run green), **FIXED (harness)** (the
finding was a defect in the audit's own measurement, corrected in the spec or
helper, not in the product), **ACCEPTED** (left as is, with the reason),
**OPEN** (not fixed in this phase).

### Critical and serious (axe)

| # | Finding | Where | Status | Change |
|---|---|---|---|---|
| A1 | `color-contrast` (serious): 1,626 nodes; the muted-text palette (`#74777f`, `#8b9199`, `#9aa7b8`, `#8794a5`, `#97a2b0`, `#94a3b8`, `#6e7580`, amber `#a9761a`) measured 2.3 to 4.47 : 1 on white and the `#f8fafc` panels (AA needs 4.5 : 1) | every page | FIXED | each token was darkened along its own hue to the lightest shade that reaches at least 4.6 : 1 on the worst background it was measured on (`#74777f` to `#666970`, `#8b9199` to `#6c7177`, `#9aa7b8` to `#69727d`, `#8794a5` to `#68727f`, `#97a2b0` to `#6a717b`, `#94a3b8` to `#687281`, `#6e7580` to `#6b717c`, `#a9761a` to `#936717`; 243 text-colour utilities in 55 files, text colours only, no dark-ground usages). The dashboard's Weekly/Monthly toggle idle text (`#64748b` on its gradient, 4.07 : 1) became `#59616f` (5.8 : 1) |
| A2 | `button-name` (critical): the sheet close button (`<X>` icon only) in every sheet: account menu, action item, evaluation detail | `src/components/ui/sheet.tsx` | FIXED | `aria-label="Close"` plus visually hidden text; icon marked decorative |
| A3 | `button-name` (critical): the per-question "Settings" toggle on the template editor hid its label below `md` (26 nodes) | `template-management-page.tsx` | FIXED | label kept for assistive technology at every width (`sr-only md:not-sr-only`) |
| A4 | `label` (critical): report name, description and every question-label input on the template editor had a visual caption but no programmatic label (58 nodes) | `template-management-page.tsx` | FIXED | `aria-label` on each input and the textarea |
| A5 | `label` (critical): the import page's file input | `data-import-page.tsx` | FIXED | `aria-label="Filled import file (CSV or XLSX)"` |
| A6 | `dlitem` (serious): `<dt>`/`<dd>` pairs in the evaluation detail sheet were not inside a `<dl>` (36 nodes) | `academic-evaluation-detail-sheet.tsx` | FIXED | the three row groups are `<dl>` elements |
| A7 | `scrollable-region-focusable` (serious): the evaluation detail sheet's scrolling body had no keyboard access | `academic-evaluation-detail-sheet.tsx` | FIXED | `role="region"`, name, `tabIndex=0`, visible focus ring |

### Moderate and minor (axe)

| # | Finding | Where | Status | Change |
|---|---|---|---|---|
| A8 | `page-has-heading-one`: login, forgot-password and access-request pages had their only `<h1>` in the hero panel, which is hidden on phones | `login-page.tsx`, `forgot-password-page.tsx`, `access-request-page.tsx` | FIXED | the form title is the `<h1>` on every viewport; the hero title is a styled paragraph |
| A9 | `heading-order`: `<h4>` day headings in the audit trail and `<h3>` chart titles directly under the shell's `<h1>` | `workspace-audit-trail.tsx`, `chart-card.tsx` | FIXED | `<h3>` and `<h2>` respectively |
| A10 | `landmark-unique`: two unlabeled `<aside>` landmarks on the evaluation form | `app-shell.tsx`, `evaluation-form-page.tsx` | FIXED | `aria-label="Sidebar"` and `aria-label="Evaluation summary"` |
| A11 | `empty-table-header` (minor): the roster's expand column header was empty | `duty-roster-page.tsx` | FIXED | visually hidden "Expand" text |

### Keyboard audit

| # | Finding | Where | Status | Change |
|---|---|---|---|---|
| K1 | Focus did not return to the control that opened a sheet after Escape (account menu, action item, evaluation detail): Radix's modal dialog focuses its own trigger ref, which is empty because every sheet here is opened from a plain button, so focus fell to `<body>` | `sheet.tsx` (all sheets), `app-shell.tsx`, `action-items-page.tsx` | FIXED | `SheetContent` records the element that had focus when it mounted and focuses it (or a visible control with the same name if the row was re-rendered meanwhile) on close; the shell and the action-item page also remember their own opener |
| K2 | Login inputs and the "Forgot password?" button had no visible focus indicator (they cleared the outline and relied on a border-colour change); the login error was not in a live region | `login-page.tsx` | FIXED | focus rings on the inputs, an outline on the button, `role="alert"` on the error line |
| K3 | The sidebar collapse button had no visible focus indicator | `app-shell.tsx` | FIXED | focus-visible ring |
| K4 | Dashboard filter selects (time range, ending period, ward trend and the occupancy scope) suppressed the focus ring (`focus:ring-0`) | `reporting-scope-panel.tsx`, `admin-dashboard-page.tsx` | FIXED | focus-visible ring restored |
| K5 | Roster and rotation tables had no caption and no `scope` on their column headers | `duty-roster-page.tsx`, `rotation-planner-page.tsx` | FIXED | visually hidden captions, `scope="col"` |
| K6 | Charts: the focusable recharts `<svg role="application">` elements had no accessible name (25 charts); the pie chart's sector group was a second unnamed tab stop | dashboard and academic pages | FIXED | every chart carries a `title` (rendered as the SVG `<title>`); the pie's sector group is out of the tab order (`rootTabIndex={-1}`), the titled SVG stays focusable |
| K7 | The admin dashboard rendered a second `<h1>` (the range title) under the shell's page title | `admin-dashboard-page.tsx` | FIXED | `<h2>` |
| K8 | The report form's status / error line ("Saved", "Unsaved changes", validation text) was not announced | `report-form.tsx` | FIXED | `role="status"`, `aria-live="polite"` |
| K9 | The "syncing" dot animated regardless of the reduced-motion preference | `app-shell.tsx` | FIXED | `motion-safe:animate-ping` |
| K10 | Time inputs appeared to trap Tab (settings deadline, evaluation "senior joined at") | audit helper | FIXED (harness) | the helper blurred and re-focused each element to measure its indicator, which reset the time input's segment cursor and turned its three Tab stops into a loop; segmented inputs are now measured without blurring. The product has no trap: plain Tab leaves a time input after its three segments |
| K11 | Focus rings reported as "none" on elements that do have one | audit helper | FIXED (harness) | the ring is transitioned (150 ms) and the snapshot read the transition's start value; transitions are cancelled for the measurement |
| K12 | Spec defects: a strict-mode locator (two "Save" buttons), the evaluation row matcher excluded every row (row names contain a date), "Mark all read" searched from inside the list instead of from the page title, the report form's action bar precedes the grid in DOM order (the spec stopped at "Save" before reaching a cell), the settings select's trigger text updates one render after the listbox closes | `a11y-keyboard.spec.ts` | FIXED (harness) | matchers and waits corrected; no product change |

### Visual audit

| # | Finding | Where | Status | Change |
|---|---|---|---|---|
| V1 | 200 % zoom: the first version of the check applied CSS `zoom: 2` to the root, which scales the desktop layout without changing the media queries and reported 230 to 283 px of horizontal overflow on four pages | `a11y-visual.spec.ts` | FIXED (harness) | browser zoom is emulated as it happens in a browser: a 640 CSS px viewport at device-pixel-ratio 2 (WCAG 1.4.4 / 1.4.10); the responsive layouts take over and the pages reflow |
| V2 | At 640 CSS px the admin dashboard's "Submission pulse" heading placed its scope filter beside the title and overflowed by 65 px | `admin-dashboard-page.tsx` (`SectionHeading`) | FIXED | the right slot stacks under the title below the `md` breakpoint |
| V3 | Touch targets at 390 px (coarse pointer): the sheet close button was 32 × 32, the workspace toggle 40 px tall, the report form's day tabs 41 px wide | `sheet.tsx`, `app-shell.tsx`, `report-form.tsx` | FIXED | close button 44 × 44, toggle `min-h-11`, day tabs `min-w-11` with a tighter grid gap |
| V4 | Large text (root `font-size` 24 px), reduced motion, forced colours and increased contrast | all audited pages | VERIFIED | large text: no clipped text or overflow; reduced motion: no transform animations, the sheet fades instead of sliding; forced colours / increased contrast: screenshots recorded in `output/a11y/visual/` for manual review and the first focus outline is checked; the spec passed before and after |

### Accepted

| # | Finding | Status | Reason |
|---|---|---|---|
| C1 | Contrast tokens were darkened globally rather than per element | ACCEPTED | the replacement shades are the lightest that pass, so the visual change is slight (about 10 % darker muted text); dark-ground usages were checked and none use these tokens |
| C2 | The recharts `<svg>` keeps `role="application"` (a recharts default) | ACCEPTED | it now has a name and its values are also presented as text (legends, tables, tiles); removing the role would remove the library's keyboard navigation |

Nothing is OPEN.

## 3. Keyboard-only flows (all VERIFIED on the re-run)

- Login: complete with the keyboard only; wrong-password error announced
  (`role="alert"`); all seven stops named and with a visible indicator.
- Nurse: open a report from My Reports, edit cells, save the draft with
  Enter, reach Submit; the status line is a live region; Tab order follows the
  visual order (action bar, then the grid).
- Admin: open a report from the submissions board; the action-item sheet opens
  with Enter, traps focus, closes with Escape and returns focus to the row's
  button; change the status by keyboard.
- Admin: settings form, including the Radix select (Space opens, arrows move,
  Enter commits, Escape cancels and returns focus to the trigger), numeric
  field, save.
- Admin: notifications, mark all read with the keyboard.
- Admin: evaluation detail sheet: focus in, trapped, Escape, focus back on the
  row.
- Admin dashboard: focus order, names, indicators and landmarks over 34 stops.
- Resident: evaluation form: pick a subject, rate, toggle, reach and press
  Submit.
- Phone (390 px): the account sheet from the tab bar: focus in, trapped, Escape,
  focus back on the trigger; the tab bar is a `nav` landmark.
- Tables: roster and rotation have captions and scoped headers.

## 4. Visual checks (all VERIFIED on the re-run)

- 200 % zoom (640 CSS px at DPR 2): login, admin dashboard, action-item sheet,
  nurse report form, resident submit: no horizontal scroll, no clipped text.
- Large text: root font size 24 px on the same pages: no overflow or clipping.
- Reduced motion: animated elements are static under
  `prefers-reduced-motion: reduce`.
- Forced colours and increased contrast: screenshots recorded for manual
  review; the first focused control keeps a system focus outline.
- Touch targets at 390 px with a coarse pointer: every interactive element in
  the report form, tab bar and sheets is at least 44 × 44 CSS px.

## 5. Method notes and limits

- The sweep drives the real application with seeded data and opens dialogs,
  sheets and menus as states; it does not exercise every combination of
  filters. The gate's `accessibility.spec.ts` keeps critical violations at
  zero on every push.
- axe cannot judge whether alternative text is meaningful, whether the reading
  order of a complex dashboard is sensible, or screen-reader usability
  end to end; a session with a screen-reader user is in the UAT plan
  (`docs/UAT_PLAN.md`, "Accessibility").
- The colour changes are the only visual change of this phase; the design
  intent (muted secondary text) is preserved.
- Chromium only; the gate's `E2E_ALL_BROWSERS=1` mode covers Firefox and
  WebKit for the functional suite, not for this audit.
