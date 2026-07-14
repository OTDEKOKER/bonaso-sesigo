# SESIGO Data Portal — Administrator Guide
*For system administrators. Covers the admin-only responsibilities. For day-to-day reporting tasks (data entry, review/approval, flags), see the **Staff Guide** — admins can do everything in it too.*

> As an administrator you have **full, unscoped access** to every organisation and module, plus the setup, security, and maintenance tools that other roles don't see.

---

## Contents
1. Administrator responsibilities
2. Getting started
3. Users, roles & permissions
4. Organizations & hierarchy
5. Projects (setup, indicators, tasks, deadlines)
6. Indicators (catalogue, disaggregation, deduplication)
7. Reporting Periods (open/close windows)
8. Overseeing the reporting & approval cycle
9. Data quality & flags (oversight)
10. Funder Report Builder (configure figures)
11. Backups & recovery
12. System Status & health
13. Settings
14. Security & data-protection duties
15. Routine admin checklist

---

## 1. Administrator responsibilities
- Manage **user accounts, roles and permissions**.
- Maintain **reference data** — organisations, projects, indicators.
- Control **reporting windows** (open/close periods).
- Safeguard data: **backups, recovery, access control, audit**.
- Monitor **system health and data quality**.
- Configure **funder-report** structure.

---

## 2. Getting started
1. Go to **`https://sesigo.org.bw`**, sign in with your admin account.
2. You see the **full sidebar**, including admin-only areas: **Users**, **System Status**, **Reporting Periods**, **Settings**, and full **Organizations/Projects/Indicators**.
3. Security: sessions auto-log-out after **30 minutes idle**; all actions are **audited** (see §3.2).

---

## 3. Users, roles & permissions

### 3.1 Manage users
1. Sidebar → **Users**.
2. **Create** a user (or edit an existing one): set **username**, **role**, **organisation**, and **module permissions**.

> 📷 **[Screenshot: the Users page / create-user form with permissions]** — *save as* `screenshots/admin-01-users.png`
3. **Roles** determine baseline capability (e.g. *M&E Officer* reviews/flags; *M&E Manager* approves; *admin* full access). **Module permissions** switch individual modules on/off for that user.
4. A user's **organisation** controls what data they can see (their org + everything beneath it in the project hierarchy).

> Access is **explicit-deny**: a user only gets modules you grant. When someone "can't see" data, check their **role**, **organisation**, and **module permissions** first.

### 3.2 Audit log
- **Users → Activity** — who did what and when (active users + recent actions). Use this to investigate any data change or access question.

> 📷 **[Screenshot: the Users → Activity audit log]** — *save as* `screenshots/admin-02-activity.png`

---

## 4. Organizations & hierarchy
1. Sidebar → **Organizations**.
2. Add/edit organisations (name, code, type).
3. Set the **hierarchy** (which organisations are **coordinators** and which are their **sub-grantees**) — this drives data scoping, review-queue routing and coordinator rollups. Hierarchy is managed per project in **Project Setup**.

> 📷 **[Screenshot: the organisation hierarchy in Project Setup]** — *save as* `screenshots/admin-03-hierarchy.png`

> Keep coordinator↔sub-grantee relationships correct — they determine who reviews whose data and how figures roll up.

---

## 5. Projects
1. Sidebar → **Projects → All Projects**.
2. Create/edit a project (name, code, dates, status).
3. **Assign indicators** to the project and **assign organisations** (and their hierarchy/coordinators).
4. Track delivery via **Projects → Tasks** and **Projects → Deadlines**.

> Setting a project to **archived/completed** stops new submissions for it.

---

## 6. Indicators
1. Sidebar → **Indicators → All Indicators**.
2. Maintain the shared indicator catalogue — codes, names, **disaggregation** (sex/age/key-population) config, and **aliases** for target-group variants.
3. **Assessments** and **Deduplication** tools are under the Indicators menu (dedup finds and merges duplicate indicators).

> Indicators are **shared system-wide**. Do **not** rename or delete an indicator to suit one project/coordinator — it affects everyone. Model variants as canonical + alias instead.

---

## 7. Reporting Periods
1. Sidebar → **Reporting Periods**.
2. **Open / close** reporting windows, **schedule** them, and manage **late** or **duplicate** submissions.
3. This governs **when users may submit** data for a period. Reporting is also blocked until a period has fully elapsed (a completed-quarter rule); a superuser can override with an audited exception when genuinely required.

> 📷 **[Screenshot: the Reporting Periods page]** — *save as* `screenshots/admin-04-reporting-periods.png`

---

## 8. Overseeing the reporting & approval cycle
Admins can act at any tier of the review workflow (see the Staff Guide §5 for the full flow):
1. Sidebar → **Aggregates → Open Queued Review**.
2. Filter by **Project / Coordinator / Organization** and **Search** (admins see **all** coordinators).
3. **Review**, **Flag**, **Approve**, or **Delete** records; use **Approve all / Delete all** on a filtered set.
4. Only **Approved** data appears in dashboards and funder reports.

> Editing an already-approved record returns it to **Pending** for re-review — expected behaviour, fully audited.

---

## 9. Data quality & flags (oversight)
- Open the **Data Quality Flags** page (⚠️ header icon).
- Filter by organisation/type/category/project/coordinator/indicator/date; open a flag for its description, affected record and resolution.
- Flags arise **manually** (a reviewer flags a record) and **automatically** (figures that don't sum, or the same value repeated across many indicators).
- **Resolve/dismiss** a verified-correct flag to restore the record to **Approved**; correcting the value clears the flag automatically.
- Use **System Status** for system-wide data-quality/parity checks.

---

## 10. Funder Report Builder
1. Sidebar → **Funder Reports → Report Builder**.
2. Configure the **figures**: map indicators to chart figures, assign each to a **section** and a **display order**, and set chart/target options.

> 📷 **[Screenshot: the Funder Report Builder]** — *save as* `screenshots/admin-05-report-builder.png`
3. **Generate Report** produces the funder report (Word/Excel) from **currently-approved** data.

---

## 11. Backups & recovery
1. Sidebar → **System Status → Backups**.
2. **Generate backup** on demand; view backup history.
3. **Encrypted download**: download a backup as an encrypted file (you re-enter your password; the action is audited and rate-limited).
4. **Restore** is a **supervised** operation — validate first, then apply. Treat restore as a disaster-recovery action, not routine.

> 📷 **[Screenshot: System Status → Backups]** — *save as* `screenshots/admin-06-backups.png`

> ⚠️ **Offsite backups:** confirm an off-site destination is configured. If backups only live on the same server, arrange an off-site copy before pilot/rollout.

---

## 12. System Status & health
- Sidebar → **System Status**: system health checks, **data parity/completeness**, and **data-quality issues** with drill-down to the affected records. Check it regularly and after any bulk operation or import.

> 📷 **[Screenshot: the System Status page]** — *save as* `screenshots/admin-07-system-status.png`

---

## 13. Settings
- Sidebar → **Settings**: system and account preferences.

---

## 14. Security & data-protection duties
- Enforce **least privilege**: grant only the roles/modules each user needs.
- Keep the **organisation hierarchy** accurate so data scoping holds.
- Ensure **backups run** and an **offsite copy** exists; test the **restore** procedure periodically.
- Use the **audit log** (Users → Activity) to review sensitive changes.
- Sessions are TLS-encrypted with idle auto-logout; backup downloads are encrypted.

---

## 15. Routine admin checklist
**Daily**
- [ ] Check the **⚠️ flags** count and **System Status** for new issues.
- [ ] Confirm the previous night's **backup** exists.

**Per reporting period**
- [ ] **Open** the reporting period; notify users.
- [ ] Monitor the **review queue**; ensure Officers review and Managers approve on time.
- [ ] **Close** the period when reporting is complete.

**Ongoing**
- [ ] Onboard users (roles, org, permissions); point them to **Training Mode** first.
- [ ] Keep organisations, projects and indicators up to date.
- [ ] Review the **audit log** for anything unexpected.

---
*Draft — verify against your live screens and confirm hosting/backup specifics before distributing.*
