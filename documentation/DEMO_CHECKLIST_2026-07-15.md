# SESIGO / BONASO — Meeting Prep Pack
**BONASO & NAHPA System Development Progress Review — 15 July 2026, 0900–1300, NAHPA Conference Room (Chair: Dr Lekgathane)**

One document, three parts:
- **Part A — Demo flow checklist** (run top-to-bottom; each step maps to an agenda item)
- **Part B — Progress & status talking points** (Agenda #3 / #5 / #8)
- **Part C — Likely tough questions & suggested answers** (Agenda #9 / #13 / #14 + pilot timeline)

> ⚠️ Verify the **bold-italic _confirm_** items against what you know before quoting them in the room.

---
---

# PART A — DEMO FLOW CHECKLIST

## 0. Pre-demo technical readiness  (do ~30 min before)
- [ ] `https://sesigo.org.bw` loads the login page cleanly (no error, no layout break)
- [ ] Both containers up: `docker ps` → `frontend-frontend-1` + `frontend-backend-1` = Up
- [ ] Demo logins ready for **3 roles**: an **admin**, an **M&E Manager**, and an **M&E Officer / coordinator**
- [ ] A recent **backup** exists (System Status → Backups) — safety net before any live edit
- [ ] Projector/screen-share tested; sensible browser zoom; dev tools closed
- [ ] Pre-open the key tabs (Dashboard, Aggregates, Flags, Reports) to avoid load waits on stage
- [ ] Decide: demo on **live** data or **Training Mode** (safer for edits)

## 1. Login & Access Control  → #6, #9
- [ ] Log in as **admin** → lands on the home dashboard
- [ ] Log in as **M&E Officer / coordinator** → data + menu are **scoped to their organisation** (role-based access control)
- [ ] Mention session security: **30-min idle auto-logout** + JWT auth

## 2. Modules Overview  → #5, #6
- [ ] Walk the left nav = the module list: Dashboard, Organizations, Projects, Indicators, **Aggregates**, Respondents, Events, Clients, Social, **Flags / Data Quality**, Reports / Analysis, **Funder Reports**, **Coordinator Targets**, Users, System Status, Backups, **Training Mode**
- [ ] One line on the purpose of each as you point

## 3. Data Entry  → #6
- [ ] **Aggregates → Reporting Workbook**: download a coordinator/CBO workbook → show the structured template
- [ ] Upload a completed workbook → show the **smart import** summary (created / updated / unchanged)
- [ ] Single aggregate entry or edit → record becomes **Pending**

## 4. Review & Approval Workflow  → #6, #8
- [ ] Open **Queued Review** → use the **Project / Coordinator / Organization filters + search** (recently fixed — confirm they narrow correctly)
- [ ] Review → **Approve**; show a **Flagged** record → correction → back to review
- [ ] Note the **two-tier** model: Officer reviews, Manager approves

## 5. Reporting & Dashboards  → #6, #7
- [ ] **Aggregates** browse + charts — apply filters/search (now cover the **full** dataset, not one page)
- [ ] **Analysis / Dashboards** and **Funder Reports** — indicator→chart figures, **Word/Excel export**
- [ ] **Coordinator Targets** — targets vs actuals rollup

## 6. Data Quality & Flags  → #8, #6
- [ ] **Flags / Data Quality** — filters (org / type / category / project / coordinator / indicator / date) + search
- [ ] Open a flag → description + resolution; mention **auto-detected** anomalies/consistency checks

## 7. Notifications  → #6
- [ ] Show in-app notifications (report uploaded, review pending, flag raised)

## 8. System Integration  → #7
- [ ] Explain data flow: entries/aggregates → derived **AggregateFact** → **rollups** → dashboards & funder reports; org **hierarchy scoping** applied consistently across modules

## 9. Data Protection & Security  → #9
- [ ] **Module permissions** (explicit-deny) + org-scoped visibility
- [ ] **Backups**: on-demand backup, **encrypted download**, supervised restore; **Users → Activity** audit log
- [ ] Be upfront: **offsite backup not yet configured** (carry to #14 as an action item)

## 10. Piloting & Rollout  → #10, #11
- [ ] Proposed pilot sites / criteria / duration / training + support
- [ ] Rollout phases & readiness criteria (pilot → full)

## 11. Training, Docs & Hosting  → #12, #13
- [ ] **Training Mode** (isolated environment for onboarding — no live-data risk)
- [ ] `SYSTEM_HANDOVER` doc; status of user/admin manuals
- [ ] Hosting: self-hosted Docker on the server behind nginx/TLS; nightly backups

## 12. Challenges & Risks (raise proactively)  → #14
- [ ] **Host RAM** pressure (server swaps under load) — mitigated with container memory limits
- [ ] **Offsite backup** not configured — action item
- [ ] Anything else surfaced in recent testing

### On-stage guidance
- **Safe to show:** filters + search (now work across full datasets), review/approval flow, funder reports, backups. Layout/overflow issues are fixed and deployed.
- **Prefer Training Mode** for any create/edit/import you do live, so you don't touch real reporting data.
- **Avoid:** deep-diving half-finished internals.

---
---

# PART B — PROGRESS & STATUS  (Agenda #3 / #5 / #8)

## #3 — Progress at a glance
- System is **live in production** (self-hosted, `sesigo.org.bw`) and in **active use for real reporting** (e.g. NAHPA Social Contracting 2026/27 coordinators + sub-grantees).
- Stage: **stabilisation / pre-pilot** — core modules built and operating; recent work is hardening, data-quality, reporting, and UI polish.
- **Recent milestones (last ~4 weeks):** reporting workbook + smart import, coordinator rollups & derived targets, funder-report builder (Word/Excel), data-quality flags, backup/restore + encrypted download, auth/session hardening, and a **system-wide filter/search + pagination fix** and **UI layout standardization** (deployed this week).

## #5 — Modules
**Completed & in use**
- **Data collection:** Respondents & Interactions, Events, Social Media, Clients
- **Aggregate reporting:** data entry, **Reporting Workbook** (generate + smart import), review & **two-tier approval**, reporting periods / quarterly control
- **Indicators:** shared catalogue, aliases, disaggregation config, assessments, deduplication
- **Organisations & Projects:** hierarchy (coordinators / sub-grantees), project setup, tasks & deadlines
- **Targets:** Coordinator Targets + server-side rollup
- **Analysis & Reporting:** dashboards, visualizer, line lists, reports, **Funder Reports** (indicator→figure, Word/Excel export, compliance table)
- **Data Quality:** Flags + auto-detected anomalies/consistency, correction queue
- **Home dashboard** (per-organisation, DHIS2-style)
- **Administration:** Users + roles/permissions + **activity/audit log**, System Status, **Backups** (on-demand, encrypted download, supervised restore)
- **Notifications / Announcements / Messages**
- **Training Mode** (isolated environment for onboarding)

**Under development / bedding in**
- Data-quality engine: checks live; dashboard/API surface being finished
- UI standardization: shared `FilterBar` primitive (reference-adopted; rolling out)

**Outstanding**
- Full user & admin manuals + training pack (#12)
- Offsite backup configuration (see Part C)

## #8 — Testing
**Done**
- **Automated backend test suite: ~638 tests, essentially all passing** (1 known benign test-harness collision — not a product defect)
- Regression tests for high-risk areas: workbook import, review/approval hardening, period/overlap guards, filters, correction-flag lifecycle
- **Internal QA this cycle** found + fixed real issues: filters/search only covering one page, review-queue org filter, UI overflow/overlap — all corrected and deployed
- Deploys are build+lint validated and **rollback-tagged** before going live

**Outstanding**
- Structured **User Acceptance Testing (UAT)** with real users on pilot sites
- Visual QA of the in-progress UI standardization
- Load / performance testing under concurrent multi-user use

---
---

# PART C — LIKELY TOUGH QUESTIONS & SUGGESTED ANSWERS

**Q1. Where is our data hosted and who owns it?**  → #9, #13
> The system is **self-hosted** on a dedicated server under BONASO's control (Docker + nginx/TLS). The **data belongs to BONASO/NAHPA**, is not shared with third parties, and can be **exported** (CSV/Excel/Word) at any time. **_Confirm_**: exact server location/provider and the data-ownership wording in any agreement.

**Q2. What happens if the server goes down?**  → #13, #14
> Containers **auto-restart** on failure. **Nightly backups** are taken, and there is a **supervised restore** procedure (validate, then apply). The current gap we're closing is an **offsite copy** of backups — today they live on the same host, so an off-site destination is the next step before pilot.

**Q3. How is data kept secure / protected?**  → #9
> **Role-based access** with explicit-deny permissions and **organisation-scoped visibility** (users only see their own org's data). **Encrypted** backup downloads, a full **audit log** of user activity, **TLS** in transit, **JWT** auth with **idle auto-logout**. **_Confirm_** alignment with the specific data-protection requirement/regulation they cite.

**Q4. Can it integrate with other systems (e.g. DHIS2)?**  → #7
> Internally, modules are fully integrated (one data flow feeds dashboards, rollups and funder reports). **External** integration (e.g. DHIS2) is **not built yet** but is feasible via export/API; we'd scope it if it's a requirement. (Better to be honest than over-promise.)

**Q5. When can we pilot, and what's the timeline?**  → #10, #11
> We propose piloting once three readiness items are done: **(1)** offsite backup configured, **(2)** an initial **UAT** with users, **(3)** **training materials** ready. A phased approach: pilot with a small set of sites/coordinators → gather feedback → then staged full rollout. **_Confirm_** the specific dates/sites you want to commit to.

**Q6. What's still outstanding before full rollout?**
> Offsite backup, structured UAT, user/admin manuals + training, and load testing under real concurrency. Core functionality is in place and in use.

**Q7. What are the running costs / long-term sustainability?**  → #13
> Ongoing costs are **hosting + maintenance/support**. **_Confirm_** the actual figures and the support/maintenance arrangement — do **not** quote numbers you haven't verified.

**Q8. Is the system reliable / has it been tested?**  → #8
> Yes — a comprehensive automated test suite plus internal QA each cycle (which recently caught and fixed filter and layout issues, now deployed). The remaining step is formal **UAT** with end users, planned as part of the pilot.

---
*Uncommitted helper file — edit/move/delete freely.*
