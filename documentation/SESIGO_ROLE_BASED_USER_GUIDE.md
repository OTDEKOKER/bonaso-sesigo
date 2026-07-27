# SESIGO Data Portal — Role-Based User & Operations Guide

Plain-language guide to using SESIGO for each role, following the full reporting
journey. For the help desk, see `SESIGO_HELP_DESK_GUIDE.md`. For administrators/
technical operators, the deep runbooks are `SYSTEM_HANDOVER.md`,
`SESIGO_DISASTER_RECOVERY_RUNBOOK.md`, `BACKUP_ADMIN_GUIDE.md`,
`SESIGO_INFRA_SECURITY_HARDENING_RUNBOOK.md` and `DATABASE_ACCESS_GUIDE.md`.

---

## Who does what

| Role | In short |
|---|---|
| **Sub-grantee / reporting user** | Downloads its workbook, fills it in, uploads it, fixes anything flagged. |
| **Coordinator user** | Same as a sub-grantee for its own data, **plus** sees its sub-grantees (its part of the hierarchy) and their reporting. |
| **M&E Officer / Reviewer** | Reviews submitted data for their organisation and its descendants; marks it reviewed, flags problems, or rejects. Cannot give final approval. |
| **M&E Manager** | Everything an officer does **plus** final **approval**. |
| **Administrator** | Full access: configuration, users, reporting periods, overrides, backups. |
| **Client / Funder** | Read-only: dashboards, analytics and funder reports. Cannot enter or change data. |

Unknown or unset roles are **denied by default** — a login with no valid role can
see nothing.

---

## The reporting journey (all reporting roles)

### 1. Log in
- Go to `https://sesigo.org.bw` and sign in. Live and Training are separate; the
  login screen lets you choose Training for practice (training data never mixes
  with live reporting).
- On first sign-in each period you may be asked to accept the confidentiality
  notice — tick the box and click **OK**. You cannot reach any page until you do.
- **Forgot password / locked out:** use the password-reset link, or ask an
  administrator to reset it (Users → the user → Reset password). Raise a
  **Login or access** support ticket if you're still stuck.

### 2. See only what you're allowed to
- You see **your organisation and its authorised descendants** for the projects
  you're assigned to — nothing from sibling organisations or other projects.
- If an organisation or project you expect is missing, it's almost always a
  membership/assignment matter — raise an **Organisation hierarchy** or
  **Permission or role** ticket rather than assuming it's a bug.

### 3. Indicators & targets (who configures them)
- Indicators and targets are configured centrally (Admins / Managers). Reporting
  users don't create them; you report against the ones assigned to your
  organisation for the project.
- If a target looks wrong, raise an **Indicator or target** ticket — targets are
  never changed without explicit approval.

### 4. Download your workbook
- Go to **Uploads** (or the workbook area) and download your organisation's
  Excel workbook. Coordinators can download a single organisation, their
  coordinator set (with data), or the whole programme workbook.
- **Do not change the layout** — don't rename, reorder or delete sheets, columns
  or indicators. The importer relies on the exact structure you were given.

### 5. Complete it offline
- Fill in the numbers in the provided cells. Keep disaggregation (age/sex/key
  population) in the columns as laid out.
- Save as `.xlsx` (or the format you were given). Don't password-protect it.

### 6. Upload it
- Go to **Uploads → upload**, choose your file, and submit. Large files are
  processed in the background — you'll get a notification when it finishes.
- **Retrying is safe.** Uploading the same period again updates the existing
  records; it does **not** create duplicates.

### 7. Validation errors
- If the importer reports problems, it tells you which sheet/row/indicator. Common
  causes: a renamed/removed column, text where a number is expected, a typo in an
  indicator name, or reporting into a period that isn't open yet.
- Fix the file and re-upload. If the message is unclear, raise a **Validation
  error** ticket and attach the details (never a stack trace — you won't see one;
  the system only shows safe messages).

### 8. Submit → review → flag → correct → approve
- After a successful upload your data is **submitted** (pending review).
- An **M&E Officer** reviews it: marks it **reviewed**, **flags** it for
  correction, or **rejects** it. Flags come back to **your** organisation.
- If flagged, open the flag, make the correction, and re-submit. The full history
  is retained — corrections never erase the record of what happened.
- An **M&E Manager** gives final **approval**. Only **approved** data appears in
  official dashboards, analytics and funder reports (a clearly-labelled preview is
  the only exception).

### 9. Reporting periods
- You can only report for a period once it has fully elapsed, and only while the
  window is open. Quarter labels and dates are consistent across the app,
  workbook, dashboards and reports.
- If you genuinely need to report into a closed/late period, that requires an
  **administrator override**, which is explicit and audited — raise a
  **Submission** ticket.

### 10. Duplicate handling
- The system prevents the same organisation submitting the same indicator, for the
  same project and period, twice — through both the screens and the upload path.
- If you think a duplicate exists, don't try to force a second entry; raise a
  ticket and support will investigate (overrides are explicit and audited).

---

## Role specifics

### Sub-grantee / reporting user
Focus on steps 4–8 above for your own organisation. You cannot see other
organisations. Your reviewers are notified automatically when you submit.

### Coordinator user
As above, plus you can pick your sub-grantees when downloading/reviewing, and you
see roll-ups across your part of the hierarchy. You still cannot reach
organisations outside your coordinator tree.

### M&E Officer / Reviewer
- Use the **review queue** (Aggregates) to work submitted data for your
  organisation and its descendants.
- Mark **reviewed**, **flag** (with a clear reason), or **reject**. You **cannot**
  approve — that's a Manager/Admin step by design (separation of duties).
- You're limited to your own organisation scope automatically.

### M&E Manager
- Everything an Officer does, plus final **approve**. Approving stamps your
  identity and time on the record.
- Approve only data that has passed review. The system blocks illegal jumps (e.g.
  approving a brand-new record without review).

### Administrator
- Configure projects, organisations, hierarchy, indicators, targets and users.
- Manage **reporting periods** (open/close/late windows) and, when justified,
  perform explicit **overrides** (all audited).
- Run backups and, if ever needed, supervised restores (see the backup/DR
  runbooks). Never run heavy database jobs concurrently on the server.
- Manage module permissions per user (including the new **Support** module).

### Client / Funder
- Read-only. Use **Dashboards**, **Analytics** and **Funder Reports** to view
  approved results and export them (Excel/Word). You cannot enter or change data,
  even for an organisation that appears in your scope.

### Technical support staff
- Use the **Support** module to triage (see the Help Desk guide).
- For data questions, start with the **read-only** classifier
  (`python manage.py audit_historical_exceptions`) and never remediate on
  production without a reversible, audited, dry-run-first command and sign-off.

---

## Dashboards, analytics, funder reports & exports
- **Dashboards** give a per-organisation overview; **Analytics** lets you build
  charts; **Funder Reports** produce the formatted figures/tables for funders.
- All of these read **approved** data only, scoped to what you're allowed to see.
- **Export** to Excel or Word from the relevant screen. Totals are consistent
  across the review queue, analytics, dashboards, coordinator roll-ups, funder
  reports and exports because they all read the same approved source.

---

## Common troubleshooting (before raising a ticket)

| Symptom | Likely cause | What to do |
|---|---|---|
| Can't log in | Wrong password / inactive account | Reset password; ask an admin to confirm the account is active. |
| Stuck on the confidentiality notice | Checkbox not ticked | Tick the box, then **OK**. |
| An organisation/project is missing | Membership/assignment, not a bug | Raise an **Organisation hierarchy** / **Permission** ticket. |
| Upload rejected with validation errors | Layout changed, text in a number cell, indicator typo, or period not open | Re-download a fresh workbook, re-enter into the original layout, check the period is open. |
| "Reporting is not open for this period" | Quarter not elapsed or window closed | Wait until the period opens, or request an audited override. |
| Uploaded twice — worried about duplicates | Re-upload is idempotent | It updates, not duplicates. Confirm counts on the Aggregates page. |
| Numbers differ between a screen and an export | Usually a filter/period/scope difference | Check the period, organisation and status filters match; if still off, raise a **Dashboard or analytics** ticket. |
| A target looks wrong | Config matter | Raise an **Indicator or target** ticket; targets are only changed with approval. |

If it isn't listed, raise a support ticket with the exact steps, the organisation,
the project and the reporting period. The clearer the report, the faster the fix.
