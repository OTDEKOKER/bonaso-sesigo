# Grants — Finance User Guide

A guide to the Grants module of the Sesigo Data Portal, written for finance and
accounting staff. The module is a simple ledger for accounting for grant funding:
what was **awarded** to each organisation, what has been **paid out** to them, and
what they have **spent** — so you can see, at any time, how much is left and
whether anyone is over- or under-spending. Coordinators' figures are
**consolidated** automatically from their sub-grantees.

## The terms we use

- **Award (grant):** the total funding committed to an organisation for a project.
- **Budget line:** the award broken down by expense category (e.g. Personnel,
  Activities, Travel).
- **Disbursement:** money actually **paid to** the organisation — a tranche or
  instalment. Recorded by date and amount.
- **Expenditure:** money the organisation has **spent**, recorded by date and
  category. (Attach a supporting document where required.)
- **Remaining balance:** Award − Expenditure — funds not yet spent.
- **Cash on hand:** Disbursed − Spent — money received but not yet spent.
- **Burn rate:** Expenditure ÷ Award, shown as a percentage. Over 100% means the
  organisation has spent more than it was awarded (overspent).
- **Coordinator consolidation (roll-up):** a coordinator's figures are its own
  award and spending **plus** all of its sub-grantees' — much like a head office
  consolidating its branches' accounts.
- **Financial year & quarters:** the year runs **April to March**. Q1 = Apr–Jun,
  Q2 = Jul–Sep, Q3 = Oct–Dec, Q4 = Jan–Mar.

## Who can do what

- **Finance officer** — can create and edit awards, and record disbursements,
  expenditure and budget lines.
- **Coordinator** — can **view** its own and its sub-grantees' grants (read-only);
  cannot change anything.
- **Administrator** — full access.
- **Everyone else** — no access. The module is hidden until access is granted, so
  financial data is never shown to staff who should not see it.

## Recording the money (day to day)

1. **Open Grants** from the left-hand menu.
2. **Record an award** — click **New grant**, choose the organisation and project,
   then enter the amount, currency, a reference/title, the start and end dates and
   the status (draft / active / suspended / closed).
3. **Enter the budget** (optional) — open the grant and add **budget lines** by
   category, so the award is split into planned amounts.
4. **Record disbursements** — each time money is paid to the organisation, add a
   disbursement (date, amount, tranche number).
5. **Record expenditure** — as the organisation spends, add expenditure entries
   (date, category, amount, and a supporting document if needed).
6. **Correct or remove** — use **Edit grant** to fix details, or **Delete grant**
   to remove an award and its records.

> Tip: always enter the **correct date** on an expenditure — the quarterly report
> places each amount into a financial quarter based on that date.

## Reading the reports

**Summary by organisation.** For every organisation: **Awarded, Disbursed, Spent,
Remaining** and **Burn %**, with a grand total at the foot. Spending is colour-coded:

- green = within budget,
- amber = near the limit (90–100%),
- red = over budget (above 100%).

**Quarterly expenditure (by coordinator).** Expenditure for each organisation split
across the four financial quarters, with each coordinator shown as a **consolidated
total** (its own plus its sub-grantees), and a grand total. Choose the financial
year from the selector at the top.

**Export.** The **Export CSV** button downloads the summary to open in Excel.

## A worked example

Reading the summary for one coordinator and its two sub-grantees:

```
Organisation      Awarded    Disbursed     Spent   Remaining   Burn
--------------------------------------------------------------------
Coordinator A   1,000,000      900,000   950,000      50,000   95%   (amber)
  MBGE            600,000      600,000   660,000     -60,000  110%   (red, overspent)
  BONELA          400,000      300,000   290,000     110,000   73%   (green)
--------------------------------------------------------------------
CONSOLIDATED    2,000,000    1,800,000 1,900,000     100,000   95%
```

- **Remaining** is Award − Spent (MBGE is negative because it overspent).
- **Burn** is Spent ÷ Award; MBGE at 110% has spent more than its award.
- The **Consolidated** line is the coordinator's own figures plus both sub-grantees.

The quarterly view then shows the same spending split by quarter, e.g.:

```
Organisation       Awarded      Q1        Q2        Q3       Q4    FY total
---------------------------------------------------------------------------
Coordinator A    1,000,000   180,000    40,000    30,000       0    250,000
  MBGE             600,000   120,000         0    30,000       0    150,000
  BONELA           400,000    60,000    40,000         0       0    100,000
```

## Coming soon: cost-per-result (value for money)

A future addition will show **cost per result** — money spent divided by results
delivered (for example, cost per person reached) — so you can compare how
efficiently organisations turn funding into outputs. This needs the programme to
**nominate which result to measure against**; once chosen, it will appear on the
coordinator consolidation. Until then it is intentionally left blank, so no
misleading figure is ever shown.

## Getting access / support

To be given access, ask an administrator to enable the **Grants** module for your
account — **Finance** (full) or **Coordinator** (view only). For help, use the
in-app Support / help-desk.
