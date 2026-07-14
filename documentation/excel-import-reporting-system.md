# Excel Import and Report Generation System

## Goal

Design a workbook-driven reporting pipeline that can:

1. Import quarterly Excel reports from partner organizations.
2. Read the `Indicator matrix` sheet as the source of coordinator-to-sub indicator assignment and quarterly targets.
3. Detect organization worksheets by sheet name and map each sheet to the correct reporting organization.
4. Normalize disaggregated values into relational records.
5. Reproduce a near-identical Excel workbook for export.

This design is based on the current BONASO frontend architecture and an inspected sample workbook from the Q3 2025/26 cycle:
`Quarter 3 2025 Makgabaneng NCD REPORT.xlsx`.

## Observed Workbook Shape

The sample workbook is not a flat spreadsheet. It is a reporting form with rich layout:

- `20` worksheets total.
- One `Indicator matrix` sheet with coordinator-level indicator assignment and quarterly targets.
- Multiple organization sheets, where the worksheet name is the reporting organization name.
- Heavy use of merged cells:
  - `Indicator matrix`: `26` merged ranges.
  - Organization sheets: roughly `407` merged ranges each.
- Repeated header/title patterns:
  - `HUMAN IMMUNODEFICIENCY VIRUSES & NON COMMUNICABLE DISEASE COMMUNITY - BASED MONTHLY REPORTING TOOL`
  - `DISTRICT:`
  - `NAMES:`
  - `DATE:`
- Indicator tables are embedded deeper in the worksheet, not always starting at row 1.

This means the system must treat Excel as a semi-structured document, not just a row/column import. Import also needs two passes:

1. Parse the `Indicator matrix` sheet first to determine indicator assignment and quarter targets.
2. Parse each organization sheet and only upload indicator data assigned to that sheet's organization.

## Architecture

### Core modules

1. `WorkbookIngestionService`
   - Saves upload metadata.
   - Opens workbook with `openpyxl.load_workbook(..., data_only=False)`.
   - Captures workbook, sheet, merged-cell, row/column, and style metadata.

2. `WorkbookTemplateMatcher`
   - Compares each sheet against known templates.
   - Uses weighted similarity on titles, merged regions, header labels, and table anchors.
   - Produces the best template and confidence score.

3. `WorksheetStructureAnalyzer`
   - Finds title blocks.
   - Detects header rows, row-label columns, numeric matrix ranges, and totals rows.
   - Extracts organization, project, indicator, and period hints.
   - Treats the worksheet name as the primary organization identifier for organization report sheets.

4. `CoordinatorAssignmentResolver`
   - Parses the `Indicator matrix` sheet before organization sheets.
   - Resolves indicator assignment from coordinator to sub-partners.
   - Extracts April-to-March quarterly targets.
   - Produces the assignment map used by downstream import validation.

5. `WorkbookNormalizationService`
   - Converts matrix cells into normalized aggregate records.
   - Records source lineage:
     - sheet name
     - cell reference
     - template used
     - row/column labels

6. `WorkbookValidationEngine`
   - Validates required fields, indicator mappings, numeric values, and totals.
   - Confirms organization sheets only upload indicators assigned in the `Indicator matrix`.
   - Produces warnings/errors before commit.

7. `WorkbookExportService`
   - Rebuilds report workbook from normalized data.
   - Reapplies merged cells, widths, borders, fills, fonts, and alignment.
   - Supports single-org, coordinator, all-org, and consolidated outputs.

## Data Model

### Import/session tables

#### `report_workbook_import`

- `id`
- `upload_id`
- `file_name`
- `organization_id` nullable
- `project_id` nullable
- `reporting_period`
- `status` (`uploaded`, `analyzing`, `ready_for_review`, `validated`, `imported`, `failed`)
- `template_version` nullable
- `created_by_id`
- `created_at`
- `updated_at`

#### `report_workbook_sheet`

- `id`
- `import_id`
- `sheet_name`
- `sheet_index`
- `sheet_role` (`indicator_matrix`, `organization_report`, `summary`, `unknown`)
- `template_id` nullable
- `template_confidence`
- `organization_name_detected`
- `project_name_detected`
- `indicator_name_detected`
- `reporting_period_detected`
- `analysis_payload` JSONB
- `status`

#### `report_workbook_validation_issue`

- `id`
- `import_id`
- `sheet_id` nullable
- `severity` (`info`, `warning`, `error`)
- `code`
- `message`
- `cell_ref` nullable
- `details` JSONB

#### `report_workbook_assignment`

- `id`
- `import_id`
- `coordinator_organization_id`
- `organization_id`
- `indicator_id`
- `source_sheet`
- `source_row_ref`
- `assignment_confidence`
- `target_q1`
- `target_q2`
- `target_q3`
- `target_q4`
- `annual_target`
- `financial_year_label`

### Template tables

#### `report_template`

- `id`
- `template_name`
- `report_category`
- `workbook_scope` (`sheet`, `workbook`)
- `title_patterns` JSONB
- `header_patterns` JSONB
- `table_start_pattern`
- `table_end_pattern`
- `row_labels` JSONB
- `column_labels` JSONB
- `merged_ranges_signature` JSONB
- `style_signature` JSONB
- `version`
- `is_active`

#### `report_template_sheet`

- `id`
- `template_id`
- `sheet_name_pattern`
- `expected_titles` JSONB
- `table_regions` JSONB
- `metadata_cells` JSONB
- `style_map` JSONB

### Normalized fact tables

#### `aggregate_record`

- `id`
- `project_id`
- `indicator_id`
- `organization_id`
- `reporting_period_start`
- `reporting_period_end`
- `row_label`
- `column_label`
- `value`
- `source_import_id`
- `source_sheet`
- `source_cell`
- `template_id` nullable
- `assigned_via_matrix`
- `target_q1`
- `target_q2`
- `target_q3`
- `target_q4`
- `metadata` JSONB

Example:

```json
{
  "project_id": 14,
  "indicator_id": 222,
  "organization_id": 31,
  "reporting_period_start": "2025-07-01",
  "reporting_period_end": "2025-09-30",
  "row_label": "Female",
  "column_label": "Age 15-24",
  "value": 23,
  "source_sheet": "Makgabaneng",
  "source_cell": "H42"
}
```

## Import Pipeline

### Step 1: Upload

`POST /api/report-workbooks/imports/`

- Save file to upload storage.
- Create `report_workbook_import`.
- Infer initial organization hint from:
  - file name
  - upload metadata

### Step 2: Workbook scan

For each worksheet extract:

- sheet name
- dimensions
- merged ranges
- non-empty cells
- formulas
- row heights
- column widths
- styles and borders
- images and drawings if needed for template fidelity

### Step 3: Metadata detection

Detect:

- organization
- project
- reporting period
- indicator title
- district/locality
- table title / section title

Use ordered heuristics:

1. For organization report sheets, resolve organization from `sheet_name` first.
2. Explicit metadata cells defined by template.
3. Sheet titles and merged title blocks.
4. Filename tokens for workbook-level coordinator hints.
5. Known organization aliases.

### Step 4: Coordinator assignment matrix parsing

Parse the `Indicator matrix` sheet before any organization data sheet.

The matrix must provide:

- the coordinator indicator catalogue
- which indicators are assigned to which sub-partners
- quarterly targets for each assigned indicator

Expected outputs:

- `organization -> assigned indicators`
- `indicator -> assigned organizations`
- `organization + indicator -> q1/q2/q3/q4 target`
- annual target where present

Quarter mapping must follow the April-to-March reporting year used by this workbook:

- `Q1 = April 1 to June 30`
- `Q2 = July 1 to September 30`
- `Q3 = October 1 to December 31`
- `Q4 = January 1 to March 31`

Example:

- `Quarter 3 2025/26` means `October 1, 2025` through `December 31, 2025`.

### Step 5: Organization table detection

For each sheet:

1. Locate dense numeric regions.
2. Backtrack upward for header rows.
3. Backtrack leftward for row labels.
4. Detect totals rows using terms like:
   - `total`
   - `subtotal`
   - `grand total`
5. Identify disaggregation axes:
   - sex
   - age group
   - key population
   - service category

Only process sheets classified as organization report sheets. Do not treat the `Indicator matrix` as a normal aggregate-value data sheet.

### Step 6: Template match

Weighted scoring example:

- title similarity: `30%`
- merged-cell signature similarity: `20%`
- header labels match: `25%`
- table anchor positions: `15%`
- style fingerprint: `10%`

Fallback behavior:

- score `>= 0.85`: use template directly
- score `0.60 - 0.84`: use template with warnings
- score `< 0.60`: generic parser

### Step 7: Normalization

Each numeric matrix cell becomes one normalized record:

- `row_label`
- `column_label`
- `value`
- `source_sheet`
- `source_cell`
- resolved `indicator_id`
- resolved `organization_id`
- resolved `project_id`
- reporting period
- linked quarterly targets from the `Indicator matrix`
- assignment status from the coordinator distribution map

Upload rule:

- If the sheet name resolves to organization `X`, only indicators assigned to organization `X` in the `Indicator matrix` may be imported from that sheet.
- If a sheet contains values for an indicator not assigned to that organization, raise a validation error or warning based on configured strictness.

### Step 8: Validation

Rules:

- numeric fields must parse cleanly
- totals must equal component sums within tolerance
- organization must resolve
- indicator must resolve
- period must resolve
- duplicate source cells must not create duplicate fact rows
- sheet name must match a known organization
- indicator must be assigned to that organization in the `Indicator matrix`
- quarterly target mapping must respect `Q3 2025/26 = October 1, 2025 to December 31, 2025`

If an indicator referenced in the `Indicator matrix` or organization sheets does not exist in the system:

- mark it as a `missing indicator candidate`
- suggest:
  - name
  - code
  - category
  - type
  - sub-labels / disaggregation structure
- attach assignment context:
  - project
  - assigned organizations
  - q1/q2/q3/q4 targets

The user should be able to confirm:

1. create the missing indicator
2. assign it to the project
3. assign it to the relevant organizations from the matrix
4. create quarterly targets from the matrix values

Return:

- rows imported
- rows skipped
- warnings
- errors
- sheet-level summary

### Step 9: Commit

`POST /api/report-workbooks/imports/{id}/confirm/`

- Persist normalized records in batches.
- Write validation audit trail.
- Store template used for regeneration.
- Sync imported assignment and target data where the backend model supports coordinator-distributed indicator links.

## Template Recognition Strategy

Templates should be cached in memory keyed by:

- workbook family
- project/programme area
- template version

Each template should define:

- expected title blocks
- metadata cells
- sheet role
- header labels
- merged-cell map
- row-label regions
- column-label regions
- totals rows
- styling instructions for export

Generic parser fallback should still output:

- detected title
- detected matrix bounds
- candidate row labels
- candidate column labels
- unresolved issues for manual review

## Export Generation

### Export types

1. Single organization report
2. Coordinator report
3. All organizations report
4. Consolidated report

### Strategy

1. Choose template by project/programme/report family.
2. Clone workbook or rebuild from template definition.
3. Fill metadata cells:
   - project
   - organization
   - coordinator
   - period
   - generated timestamp
4. Rebuild the `Indicator matrix` sheet from stored indicator assignment and quarterly target data.
5. Fill organization sheets from normalized aggregates, limited to indicators assigned to that organization.
6. Recalculate totals.
7. Reapply styles:
   - merged ranges
   - borders
   - fills
   - fonts
   - alignment
   - column widths
   - row heights

### Fidelity guidance

- Use `openpyxl` named styles or direct style copy from a stored template workbook.
- Preserve merged headers exactly where possible.
- Keep section titles and indicator wording identical to the original form.
- Store workbook template files in object storage or template media directory for cloning.

## API Endpoints

### Imports

- `POST /api/report-workbooks/imports/`
  - Upload workbook and create import session.
- `GET /api/report-workbooks/imports/`
  - List sessions.
- `GET /api/report-workbooks/imports/{id}/`
  - Session detail with sheet analysis and issues.
- `POST /api/report-workbooks/imports/{id}/analyze/`
  - Run matrix parsing, organization sheet detection, template matching, and validation.
- `POST /api/report-workbooks/imports/{id}/confirm/`
  - Commit normalized records and assignment mappings.
- `POST /api/report-workbooks/imports/{id}/create-missing-indicators/`
  - Create missing indicators, assign them to the project, and create quarter targets from the matrix.

### Templates

- `GET /api/report-workbooks/templates/`
- `GET /api/report-workbooks/templates/{id}/`
- `POST /api/report-workbooks/templates/`
- `PATCH /api/report-workbooks/templates/{id}/`

### Exports

- `POST /api/report-workbooks/exports/`
  - Create export job.
- `GET /api/report-workbooks/exports/{id}/`
  - Check status.
- `GET /api/report-workbooks/exports/{id}/download/`
  - Download workbook.

## Frontend Workflow

### Import

1. Upload workbook.
2. Display detected sheets.
3. Identify the `Indicator matrix` sheet and preview detected assignments.
4. Show template match confidence per sheet.
5. Show parsed metadata:
   - organization
   - period
   - indicator
   - table bounds
6. Show assignment mismatches between sheet indicators and matrix assignments.
7. Show missing indicators and let the user create them.
8. Show validation issues.
9. Allow confirm import.

### Export

1. Select project.
2. Select reporting period.
3. Select organization scope.
4. Choose export type.
5. Rebuild coordinator assignment and quarter targets.
6. Generate workbook.
7. Download generated Excel file.

## Performance

### Backend

- Cache template definitions in Redis or in-process LRU.
- Batch insert aggregate records with `bulk_create`.
- Use sheet-level analysis workers for very large workbooks.
- Store compact cell metadata JSON instead of every style detail when not needed.
- Reuse cloned template workbooks for export jobs.

### Database

Recommended indexes:

- `(project_id, organization_id, reporting_period_start, reporting_period_end)`
- `(indicator_id, organization_id, reporting_period_start)`
- `(source_import_id, source_sheet, source_cell)` unique where appropriate

## Implementation Plan

### Phase 1

- Add Django models and REST endpoints.
- Upload + analyze + preview workflow.
- Parse `Indicator matrix` assignments and quarter targets.
- Generic parser for organization sheets.

### Phase 2

- Template matcher and saved template definitions.
- Validation engine with totals checks.
- Assignment validation between matrix and organization sheets.
- Missing indicator detection and creation workflow.
- Batch import commit.

### Phase 3

- Excel export generator with template cloning.
- Consolidated/coordinator workbook outputs.
- Style fidelity improvements.

### Phase 4

- Manual correction UI for unresolved sheets.
- Template training from accepted imports.
- Regression test corpus from historical workbooks.

## Testing Strategy

- Golden-file tests using real historical workbooks.
- Snapshot sheet-analysis tests.
- Totals-validation unit tests.
- Export round-trip tests:
  - import workbook
  - normalize
  - regenerate
  - compare key cells/merged ranges/style signatures

## Notes For This Repo

- Existing aggregate import/export flows live under:
  - `lib/aggregates/aggregate-import.ts`
  - `lib/api/services/aggregates.ts`
  - `app/(dashboard)/uploads/page.tsx`
  - `app/(dashboard)/uploads/imports/page.tsx`
  - `app/(dashboard)/reports/page.tsx`
- The new workbook system should sit alongside those flows, not replace them immediately.
- Frontend contract scaffolding is in `lib/api/services/report-workbooks.ts`.
- Dashboard workflow page is in `app/(dashboard)/report-workbooks/page.tsx`.
