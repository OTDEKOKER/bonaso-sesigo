# Sesigo Data Portal User Manual

> ⚠️ **SUPERSEDED (kept for reference).** The current user documentation is:
> - **[SYSTEM_AND_MODULES_EXPLAINED.md](SYSTEM_AND_MODULES_EXPLAINED.md)** — plain-language overview of the whole system and every module (start here)
> - **[USER_GUIDE_STAFF.md](USER_GUIDE_STAFF.md)** — step-by-step for data collectors, M&E Officers & Managers
> - **[USER_GUIDE_ADMIN.md](USER_GUIDE_ADMIN.md)** — step-by-step for administrators
>
> The text below is the older manual, retained for history; it may not match the current screens.

*Powered by BONASO.*

## 1. Purpose
This manual explains how to use the Sesigo Data Portal to manage organizations, projects, indicators, respondents, aggregates, reports, dashboards, and flags.

The portal supports:
- Data collection and tracking
- Project and indicator management
- Organization-based target setting
- Respondent and interaction management
- Analysis, reports, and dashboards
- Offline-first usage for supported workflows

## 2. Getting Started

### Login
1. Open the portal in your browser.
2. Enter your username and password.
3. Select **Sign In**.

By default you sign in to the **Sesigo Live System** and continue to the live dashboard (`/dashboard`). For practice, use **Sesigo Training Mode** instead (the `/training/...` route) and confirm you are in Training Mode before entering any data — see *Sesigo Live System vs Sesigo Training Mode* below. If the address bar starts with `/training/`, you are in Training Mode.

If login fails:
- Check your username and password.
- Make sure you are using your username, not your email address.
- Confirm the backend server is running.
- Ask an administrator to verify your account permissions.

### Sesigo Live System vs Sesigo Training Mode
The portal has two modes that keep real programme data fully separate from practice data:

- **Sesigo Live System** — the normal portal for real programme data. This is what you use for official reporting. Log in at the standard login page; you land on `/dashboard`.
- **Sesigo Training Mode** — a safe practice area for onboarding, demonstrations, and testing. It contains only clearly-labelled **DEMO** data (for example *DEMO Org A/B/C* and indicators prefixed *DEMO —*). Nothing you do here affects live programme figures.

How to use Training Mode:
1. Go to the training login at **`/training/login`** (i.e. `https://sesigo.org.bw/training/login`), or choose **Training Mode** on the standard login screen.
2. Sign in with your normal credentials. A banner confirms you are in Sesigo Training Mode ("Demo data only. Not for official reporting.").
3. You land on **`/training/dashboard`**. While in Training Mode every page lives under the `/training/...` path and shows only demo data.

Things to know:
- **The two modes never mix.** Live dashboards, reports, exports, and totals exclude all training data, and Training Mode shows only demo data. Records you create in Training Mode are saved as training records and can never appear in the Live System (the server enforces this, not just the screen).
- **The URL tells you where you are.** If the address starts with `/training/`, you are in Sesigo Training Mode; `/dashboard` (no `/training/` prefix) is the Sesigo Live System. If you log in through Training Mode and open a live link, the portal redirects you back into Training Mode.
- **Synthetic data only.** Training Mode currently uses synthetic demo data created for practice. Because it is a separate practice environment, the records, totals, and figures you see in Training Mode will differ from the Live System — this is expected.
- **Do not use `training.sesigo.org.bw` yet.** The only supported, verified Training Mode route is `/training/...` on the main site (e.g. `https://sesigo.org.bw/training/login`). The `training.sesigo.org.bw` subdomain is not ready and should not be used.
- **Switching modes:** to move from Training Mode to the Live System, **log out** and sign back in through the standard login (not the training login). Logging out clears your training session.
- **Do not enter real data:** do not enter real client, respondent, or programme data in Training Mode unless this has been explicitly approved. Training records are for practice and may be cleared without notice.

> **IMPORTANT**
> Real programme reporting must be done in the **Sesigo Live System**.
> **Sesigo Training Mode** is only for practice, demonstrations, onboarding, and testing approved training workflows.

### Main Navigation
The left sidebar gives access to:
- `Dashboard`
- `Organizations`
- `Users`
- `Projects`
- `Indicators`
- `Respondents`
- `Aggregates`
- `Events`
- `Social Media`
- `Uploads`
- `Analysis`
- `Flags`
- `Settings`

## 3. Dashboard
Use the dashboard to see a quick summary of activity across the system.

Typical dashboard information includes:
- Active projects
- Recent activity
- Indicator and respondent summaries
- Alerts and data quality issues

## 4. Organizations
Use **Organizations** to view and manage implementing organizations.

You can:
- Open an organization record
- View related users and linked work
- Understand parent-child organization structure

Organization records are important because targets and some data access are scoped by organization.

## 5. Projects
Use **Projects** to manage implementation work, timelines, and participating organizations.

### Project List
From the project list, you can:
- View all projects
- Search and filter projects
- Open a project detail page
- Create or edit a project

### Project Detail
The project detail page shows:
- Project status
- Timeline
- Linked organizations
- Project progress
- Tasks
- Deadlines
- Organization targets

### Organization Targets in Projects
Projects now show a **Targets** tab.

This tab groups targets by organization and shows:
- Indicator
- Q1 target
- Q2 target
- Q3 target
- Q4 target
- Annual total
- Progress

This is useful when:
- the same indicator is shared by more than one organization
- each organization has its own expected target

## 6. Indicators
Use **Indicators** to define what the system tracks.

Each indicator includes:
- Name
- Code
- Description
- Category
- Type
- Unit
- Disaggregation setup
- Active/inactive state

### Indicator Detail
The indicator detail page shows:
- Indicator metadata
- Quarterly target records

### Organization-Specific Targets
Targets are now managed on the indicator pages per:
- `Project`
- `Organization`
- `Indicator`

This means one indicator can be used by multiple organizations, while each organization keeps its own target values.

### Adding or Editing Targets
Open an indicator, then use the **Organization Quarterly Targets** section.

For each target record you must choose:
- Project
- Organization
- Q1 target
- Q2 target
- Q3 target
- Q4 target
- Optional baseline value

### Financial Year
Quarter targets follow the BONASO financial year:
- `Q1`: 1 April – 30 June
- `Q2`: 1 July – 30 September
- `Q3`: 1 October – 31 December
- `Q4`: 1 January – 31 March of the following year

## 7. Respondents
Use **Respondents** to manage individual beneficiary or client records.

You can:
- View respondent details
- Edit respondent records
- Review demographics
- Create interactions
- Flag records for follow-up or quality review

### Respondent Detail Page
The respondent view is structured to match the older BONASO workflow more closely.

You can review:
- Respondent details
- Key population status
- Disability status
- HIV status
- Pregnancy information
- Flags
- Additional information

## 8. Interactions
Use **Respondents > Interactions** to track services, follow-ups, or other engagements linked to a respondent.

You can:
- Create a new interaction
- Link an interaction to an assessment, project, or event
- Review historical interactions

## 9. Aggregates
Use **Aggregates** when data is captured as totals instead of individual respondents.

This section supports:
- Aggregate data entry
- Disaggregated matrix views
- Review by organization
- Import/export workflows

## 10. Events
Use **Events** to manage activities such as trainings, outreach sessions, and community engagements.

You can:
- Create events
- Track event phases
- Add participants
- Link indicators where needed

## 11. Social Media
Use **Social Media** to manage tracked social posts and related activity where configured.

## 12. Uploads
Use **Uploads** to submit files for import into the system.

You can:
- Upload files
- Review import jobs
- Check status of processing

## 13. Analysis
Use **Analysis** for saved dashboards, chart review, and reporting workflows.

The current analysis workspace behaves more like the older BONASO analytics flow.

### Dashboards
In **Analysis > Dashboards** you can:
- Create a new dashboard
- Load an existing dashboard from the sidebar
- Select indicators
- Filter by organization
- Filter by project
- Switch chart types
- Filter by fiscal quarter or custom dates
- Save, update, or delete dashboards
- Download charts as SVG or CSV

### Reports
In **Analysis > Reports** you can:
- Create reports
- Filter reports
- View generated reports
- Download output files

## 14. Flags
Use **Flags** to manage data quality and follow-up issues.

Flags help identify:
- Data quality problems
- Records requiring review
- Follow-up needs
- Urgent items

You can:
- View all flags
- Filter by status or priority
- Review affected records
- Mark a flag as resolved

## 15. Offline Use
The portal supports offline-first behavior for some workflows.

### What Works Offline
- Previously visited pages
- Cached static assets
- Cached API `GET` responses
- Queued create/update/delete actions for later sync

### What Does Not Work Offline
- First-time data loads not already cached
- Login and token refresh
- Some server-dependent actions

### Recommended Offline Workflow
1. Open the portal while online.
2. Visit the pages you expect to use.
3. Continue working if connection drops.
4. Reconnect to allow queued changes to sync.

## 16. Common Workflows

### Create an Organization Target
1. Open **Indicators**.
2. Select an indicator.
3. Open the target section.
4. Click **Add Organization Target**.
5. Select the project.
6. Select the organization within that project.
7. Enter Q1 to Q4 values.
8. Save.

### Review Targets for a Project
1. Open **Projects**.
2. Select a project.
3. Open the **Targets** tab.
4. Review grouped organization target tables.

### Add a Respondent Interaction
1. Open **Respondents**.
2. Open a respondent record.
3. Select **New Interaction**.
4. Enter the interaction details.
5. Save.

### Create a Dashboard
1. Open **Analysis**.
2. Select **New Dashboard**.
3. Enter a dashboard name.
4. Choose indicators.
5. Choose organization or project filters if needed.
6. Select a fiscal quarter or custom dates.
7. Save the dashboard.

## 17. Troubleshooting

### I cannot see some records
Possible reasons:
- your role does not have permission
- the records belong to another organization
- filters are hiding the data
- **you are in the wrong mode** — check the URL: live records appear under `/dashboard` (Sesigo Live System), demo records under `/training/dashboard` (Sesigo Training Mode). Training data never shows in the Live System and vice versa. If you only see *DEMO* records, you are in Training Mode; log out and sign in through the standard login to return to the Live System.

### I cannot save targets
Check that:
- a project is selected
- an organization is selected
- all four quarters have values
- the organization belongs to that project

### Progress looks different from one organization to another
That is expected if:
- the organizations have different target values
- the indicator is shared but each organization has separate targets

### A page is not loading
Check:
- internet connection
- backend server availability
- session expiration

## 18. Good Practice
- Use clear project and indicator codes.
- Set targets at the organization level where indicators are shared.
- Review flags regularly.
- Confirm fiscal quarter before entering targets.
- Use project and analysis pages to review target distribution across organizations.
