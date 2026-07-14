# SESIGO Data Portal — User Guide (Staff)
*For data collectors, M&E Officers and M&E Managers (CBOs, sub-grantees, coordinators). For administrator tasks, see the Administrator Guide.*

> What you see depends on your **role** and **organisation** — you only see data for your organisation and those beneath it. If a menu item isn't listed for you, your account doesn't have access to it.

---

## Contents
1. Your role
2. Getting started (login, screen, logout)
3. The reporting cycle (overview)
4. Entering data — Reporting Workbook & direct entry
5. Reviewing & approving data
6. Flags & corrections
7. Targets
8. Dashboards & reports
9. Reports
10. Respondents & interactions
11. Other data (Events, Social, Clients)
12. Notifications
13. Training Mode (practice)
14. Tips & troubleshooting

---

## 1. Your role
- **Data collector / Officer (CBO / sub-grantee):** enter data, download/upload reporting workbooks, submit reports.
- **M&E Officer (coordinator):** review and flag submissions from your organisations.
- **M&E Manager:** approve reviewed submissions.

**Golden rule:** only **Approved** data counts in official dashboards and reports.

---

## 2. Getting started

### Log in
1. Go to **`https://sesigo.org.bw`** in your browser.
2. Enter your **username** and **password**, then click **Sign in**.
3. You land on your **Dashboard**.

> 📷 **[Screenshot: the login page]** — *save as* `screenshots/staff-01-login.png`

### The screen
- **Left sidebar** — your menu (modules you can access).
- **Top header** — Search, light/dark toggle, **Announcements** (megaphone), **Messages/Notifications**, the **⚠️ Flags** icon (open data-quality flags), and your **profile / Sign Out**.
- **Main area** — the selected page.

> 📷 **[Screenshot: the main screen — sidebar + top header]** — *save as* `screenshots/staff-02-layout.png`

### Log out & timeout
- Profile (top right) → **Sign Out**.
- You are logged out automatically after **30 minutes of inactivity** (a warning shows first). Just log back in.

---

## 3. The reporting cycle (overview)
1. A **reporting period** opens (e.g. a quarter).
2. **You enter data** — upload a **Reporting Workbook** or type figures directly.
3. Your entry is saved as **Pending**.
4. An **M&E Officer reviews** it (marks **Reviewed** or **Flags** it).
5. An **M&E Manager approves** it → it now counts in reports.
6. If **flagged**, you **correct and resubmit**; it goes back through review.

---

## 4. Entering data

### Option A — Reporting Workbook (recommended)
1. Sidebar → **Aggregates**.
2. Click **Reporting Workbook** / the download option.
3. Choose your **project**, **organisation** (coordinators can pick a sub-grantee) and **quarter**, then **Download Workbook**.

> 📷 **[Screenshot: the Reporting Workbook download dialog]** — *save as* `screenshots/staff-03-workbook-download.png`
4. Open the Excel file and fill the highlighted cells — the sheet already contains your indicators. **Do not add or move columns.**
5. Back in the portal, choose **Import / Upload workbook** and select your completed file.
6. Read the **import summary** (created / updated / unchanged) and fix any errors reported, then re-upload if needed.

> 📷 **[Screenshot: the workbook import summary]** — *save as* `screenshots/staff-04-import-summary.png`
7. Your data is now **Pending** review.

> **Safe to re-upload:** identical rows are skipped; changed rows update; a previously-approved row you change goes back to **Pending**. **Blank cells are ignored** (they don't erase existing data) — to record a real zero, type `0`.

### Option B — Enter one aggregate directly
1. Sidebar → **Aggregates** → **Add Entry**.
2. Pick the **indicator, project, organisation, period** and enter the value (with any sex/age breakdown).
3. **Save** — the record is **Pending**.

### Find data
On **Aggregates**, use **Search** and the **filters** (project, coordinator, organisation, period). Filters cover the **whole** dataset, not just the visible page.

---

## 5. Reviewing & approving data *(M&E Officers & Managers)*
1. Sidebar → **Aggregates** → **Open Queued Review**.
2. Narrow the queue with **Search** and the **Project / Coordinator / Organization** filters. (Coordinator Officers are auto-limited to their own coordinator.)

> 📷 **[Screenshot: the Queued Review dialog with filters]** — *save as* `screenshots/staff-05-review-queue.png`
3. For each record:
   - **Review** → open, check the values, mark **Reviewed**.
   - **Flag** → choose a reason + note to send it back for correction.
   - **Approve** *(Managers/admins)* → makes it count in reports.
   - **Delete** → remove an erroneous record (flagged records are protected from bulk delete).
4. Use **Approve all** / **Delete all** to act on the whole filtered set at once.

> Two-tier model: Officers **review/flag**, Managers **approve**. A record must be reviewed before approval.

---

## 6. Flags & corrections
- Open flags from the **⚠️ icon** in the header or the **Data Quality Flags** page.
- Filter (organisation, type, category, project, coordinator, indicator, date) and **Search**; click a flag to see its **Description**, **Priority/Status**, **Affected Record** and **Resolution**. Use **Open Aggregate** to jump to the record.

> 📷 **[Screenshot: the Data Quality Flags page + Flag Details]** — *save as* `screenshots/staff-06-flag-details.png`

**To correct a flagged record:**
1. Open it (Correction Queue on Aggregates, or **Open Aggregate**).
2. Edit the value and **Save** (or re-upload a corrected workbook).
3. It returns to **Pending**, the flag clears automatically, and it re-enters review.

> Some flags are **automatic** (e.g. figures that don't add up, or the same value copied across many indicators).

---

## 7. Targets
Sidebar → **Targets → Coordinator Targets**: pick the **project** and **coordinator** to see each indicator's **target vs actual** and overall progress.

---

## 8. Dashboards & reports
- **Dashboard** (top of sidebar) — your organisation's key figures.
- **Analysis → Dashboards** — view charts.
- **Analysis → Reports** — generate reports and **export to PDF/Excel/CSV**.

---

## 9. Reports
Sidebar → **Reports → Generate Report** → produce the report from approved data and **export to Word/Excel**.

---

## 10. Respondents & interactions
Respondents are the individuals who receive services. Each respondent has a **unique ID** and a demographic profile; you then log the **interactions/services** they receive.

### 10.1 View & find respondents
1. Sidebar → **Respondents → All Respondents**.
2. Use **Search** (name or unique ID) and the **Gender** filter; switch between the **All / Active / Inactive** tabs.
3. Click a respondent to open their full record.

> 📷 **[Screenshot: the Respondents list with search + gender filter]** — *save as* `screenshots/staff-07-respondents-list.png`

### 10.2 Register a new respondent
1. On **Respondents → All Respondents**, click **Add** (new respondent).
2. Choose the **Organisation** — the **Unique ID** is generated automatically for that organisation (or type one in). Tick **Anonymous** if the person must not be named.
3. Fill the profile:
   - **First / last name**, **gender**, and **age range** *or* **date of birth**
   - **Contact** (phone / email) and **location** (plot, ward, village, district), **citizenship**
4. Record, where applicable:
   - **Key population** status (e.g. FSW, MSM, PWID, Transgender, Prisoner, Migrant, AGYW)
   - **Disability** status and any **special attributes** (e.g. pregnant, breastfeeding, orphan, out-of-school, youth)
   - **HIV status** / date positive (if collected)
5. Add any **notes** and click **Save**.

> 📷 **[Screenshot: the Add Respondent form]** — *save as* `screenshots/staff-08-respondent-add.png`

> The unique ID lets you find the same person again without duplicating them. Use **Anonymous** for sensitive cases where a name should not be stored.

### 10.3 Record an interaction / service
1. Sidebar → **Respondents → Interactions**.
2. Create an interaction linking a **respondent** to the **service / indicator**, **project** and **date**.
3. **Save** — interactions feed the programme figures and reports.

### 10.4 Edit or deactivate a respondent
- Open a respondent from the list to **view or edit** their details.
- Mark a respondent **inactive** if they should no longer appear as active (their history is kept).

---

## 11. Other data modules
- **Events:** create an event (title, type, date, participants) and record attendance/phases. Filter by **search** and **status**.
- **Social Media:** log posts (platform, link, indicator, metrics). Filter by **search** and **platform**.
- **Clients:** client/funder organisations. Filter by **search** and **status**.

---

## 12. Notifications
- **⚠️ Flags** — data-quality flags for your organisation.
- **Bell / messages** — *report uploaded*, *awaiting review*, *record flagged*.
- **Megaphone** — organisation announcements.

---

## 13. Training Mode (practice safely)
Click **Training Mode** in the sidebar — a **separate, isolated** environment where you can practise entering, uploading, reviewing and approving **without affecting real data**. Use it to learn before working on live reporting.

---

## 14. Tips & troubleshooting
- **Filter returns nothing?** Use **Clear filters** — a very specific combination can legitimately have no matches.
- **"Please download a fresh workbook":** your file is out of date — download a new one and re-enter.
- **A record you approved went back to Pending:** expected — editing approved data sends it for re-review.
- **Logged out unexpectedly:** the 30-minute inactivity timeout.
- **Something looks wrong:** **Flag** the record (don't delete it) so it's tracked and corrected.
- **Can't see a menu item or an organisation's data:** that's your role/organisation scope — ask your administrator.

---
*Draft — verify against your live screens and adjust organisation-specific wording before distributing.*
