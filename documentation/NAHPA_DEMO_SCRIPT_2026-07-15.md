# NAHPA Demo Script — Item 6 (System Functionality)
**Target: ~20 min live walk-through. Dry-run this Tuesday on a real account.**
URL: `https://sesigo.org.bw` · Training mirror: `/training/*` (isolated, safe for live demo)

| # | Step | Route | What to show / say |
|---|---|---|---|
| 1 | **Login + access control** | `/login` | Log in; land on role-based home. Say: auth is JWT, login is rate-limited, sessions time out on idle. |
| 2 | **Home dashboard** | `/dashboard` | Per-org dashboard cards (service pathway / indicators). "Each org sees only its own data." |
| 3 | **Org hierarchy** | `/organizations` | Show coordinator → sub-grantee tree (NAHPA SC = 6 coordinators, 66 sub-orgs). |
| 4 | **Project + indicators** | `/projects/3` | Project detail, indicators, targets vs achievement. |
| 5 | **Data entry — workbook** | `/uploads` | Download a coordinator workbook → show the Excel → import it back. "Round-trips their own tool." |
| 6 | **Data entry — direct** | `/aggregates` | Add-entry: pick coordinator/sub-org + indicator, enter a number. Show disaggregation. |
| 7 | **Review & approval** | `/aggregates` (review queue) | Show queued → reviewed → approved, two-tier. "Approval is Manager/admin only, audit-logged." |
| 8 | **Data quality / flags** | `/flags`, `/data-quality` | Show a flag + the automated data-quality checks. |
| 9 | **Dashboards / analysis** | `/analysis/dashboards` | Charts, coordinator rollups. |
| 10 | **Funder report** | `/funder-reports` → builder | Show figures + Table 1 compliance matrix; **export to Word** (leave-behind). |
| 11 | **Reporting periods** | `/reporting-periods` | Open/close windows, late/duplicate control. |
| 12 | **Notifications** | `/messages` | Upload confirmation + review notifications. |
| 13 | **Offline / mobile** | (Android app / PWA) | Mention offline capture + idempotent sync; show Android if available. |
| 14 | **Access-control proof** | log in as a coordinator M&E | Show they see ONLY their own tree — not other coordinators. |

**Fallback:** if room connectivity is poor, use the training stack, or pre-exported
screenshots + the Word funder report. Have both ready.

**Do NOT demo live:** deleting records, forcing overrides, or anything that mutates
real approved data. Use the training mode for any create/delete steps.
