import { WorkbookLayoutBuilder } from "@/components/workbook-layout/WorkbookLayoutBuilder"

/**
 * Dedicated Workbook Layout builder page (replaces the cramped modal).
 *
 * Route: /workbook-layouts/:coordinatorId?name=<coordinator name>
 * The coordinator name is passed for an instant header label; the builder still
 * confirms it from the loaded layout / available-indicators response.
 *
 * Next 15+: `params` and `searchParams` are Promises and MUST be awaited —
 * reading them synchronously yields `undefined`, which previously made
 * coordinatorId `NaN` (header "Coordinator #NaN") and sent `coordinator=NaN`
 * to the API (backend 500).
 */
export default async function WorkbookLayoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ coordinatorId: string }>
  searchParams?: Promise<{ name?: string; project?: string }>
}) {
  const { coordinatorId: coordinatorIdParam } = await params
  const resolvedSearchParams = (await searchParams) ?? {}
  const coordinatorId = Number(coordinatorIdParam)
  const coordinatorName = typeof resolvedSearchParams.name === "string" ? resolvedSearchParams.name : ""
  const backProject = typeof resolvedSearchParams.project === "string" ? resolvedSearchParams.project : ""
  return (
    <WorkbookLayoutBuilder
      coordinatorId={coordinatorId}
      coordinatorName={coordinatorName}
      backProjectId={backProject}
    />
  )
}
