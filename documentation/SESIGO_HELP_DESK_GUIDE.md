# SESIGO Help Desk — User & Support-Staff Guide

The SESIGO Support module is a lightweight, auditable help desk built into the
portal. It lets any user report a problem and lets support staff triage, assign,
resolve and track it — with a full history and automatic notifications.

Open it from the **Support** item in the left sidebar (`/support`).

---

## Part 1 — For everyone (raising and following a ticket)

### Raise a ticket
1. Go to **Support** → **New ticket**.
2. Fill in:
   - **Title** — a short summary ("Cannot upload Q1 workbook").
   - **Description** — what happened, what you expected, and any steps. Include
     the reporting period if relevant.
   - **Category** — pick the closest (Login/access, Workbook upload, Validation
     error, Review or approval, Dashboard/analytics, Funder report, …).
   - **Severity** — how badly it blocks you (Low / Medium / High / Critical).
   - Optionally the **Organisation**, **Project**, **Reporting period** and a
     **Reference** (e.g. an upload id).
3. Submit. Support staff are notified automatically.

> Do not put passwords or other secrets in a ticket. Never paste anything you
> were told is confidential.

### Follow your ticket
- You can see the tickets **you raised** and any raised **for your organisation**.
- Open a ticket to read the conversation, add a comment, and see its history.
- When support marks it **Resolved**, you can **Accept & close** it (if fixed) or
  **Reopen** it (if not).

### What the statuses mean
| Status | Meaning |
|---|---|
| **New** | Received, not yet looked at. |
| **Acknowledged** | Support has seen it and it's queued. |
| **Investigating** | Support is actively working on it. |
| **Awaiting user** | Support needs more information from you — please reply. |
| **Resolved** | Support believes it's fixed; please confirm. |
| **Closed** | Confirmed done. |
| **Reopened** | It came back or wasn't fully fixed. |

---

## Part 2 — For support staff (M&E Officers, Managers, Admins)

Support staff see tickets they raised, tickets assigned to them, and tickets for
organisations in their hierarchy scope. Administrators see **all** tickets.

### Triage workflow
1. **Acknowledge** a New ticket (or it auto-acknowledges when you assign it).
2. **Assign** it to the right person (the person who will actually work it).
3. Move it to **Investigating** while you work; use **Awaiting user** when you're
   blocked on the reporter.
4. Add **comments** to communicate. Tick **Internal note** for triage notes that
   the reporter should NOT see (e.g. server details) — these are hidden from them.
5. **Resolve** with resolution notes explaining what was done.
6. The reporter accepts (→ Closed) or reopens.

Every status change, assignment, priority/severity change, resolution and reopen
is written to the audit trail and visible on the ticket's **History** tab.

### Categories
Login/access · Permission or role · Organisation hierarchy · Indicator or target
· Workbook download · Workbook upload · Validation error · Submission · Review or
approval · Dashboard or analytics · Funder report · Performance · Other.

### Priority vs severity
- **Severity** = impact (set by the reporter; staff can adjust).
- **Priority** = the order support will work it (set by staff).

### Response & resolution targets (SLA)
These are targets, not contractual deadlines. The queue flags a ticket **Overdue**
once it passes its resolution target.

| Severity | First response | Resolution target |
|---|---|---|
| **Critical** | 2 hours | 8 hours |
| **High** | 8 hours | 2 days |
| **Medium** | 1 day | 5 days |
| **Low** | 3 days | 10 days |

### Escalation rules
1. **Critical** (system down, data at risk, whole org blocked from reporting near
   a deadline): assign immediately to a Manager/Admin; if not resolved within the
   target, escalate to the system administrator.
2. **Overdue High/Critical**: reassign or escalate to a Manager at the next
   working-day start.
3. **Anything touching data integrity, approvals, or possible data loss**: do NOT
   self-remediate on production. Raise with the system administrator and follow
   the historical-data / remediation runbooks (report-only first, reversible
   commands, audited).
4. **Security concerns** (suspected account compromise, permission leak): escalate
   to an Admin immediately and, if warranted, reset the affected account.

### The operational queue
The Support page shows live counts (Total / Open / Unassigned / Overdue) and
filters by status, category and free-text search. Use **Unassigned** + **Overdue**
to run daily triage. The `stats` view is scoped to what you're allowed to see.

---

## Notes for administrators
- Support is a per-user module: by default every role can raise and follow their
  own tickets; Managers/Officers can triage. You can restrict a specific user via
  their module permissions (Users → permissions) exactly like any other module.
- Tickets are an audit surface — only administrators can delete one, and the
  deletion is itself audited.
- Notifications reuse the in-app notification system. Email is only sent if the
  server `EMAIL_*` settings are configured; otherwise the in-app bell is the
  channel.
