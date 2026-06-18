import { WorkbookLayoutBuilder } from "@/components/workbook-layout/WorkbookLayoutBuilder"

/**
 * Dedicated Workbook Layout builder page (replaces the cramped modal).
 *
 * Route: /workbook-layouts/:coordinatorId?name=<coordinator name>
 * The coordinator name is passed for an instant header label; the builder still
 * confirms it from the loaded layout / available-indicators response.
 */
export default function WorkbookLayoutPage({
  params,
  searchParams,
}: {
  params: { coordinatorId: string }
  searchParams?: { name?: string; project?: string }
}) {
  const coordinatorId = Number(params.coordinatorId)
  const coordinatorName = typeof searchParams?.name === "string" ? searchParams.name : ""
  const backProject = typeof searchParams?.project === "string" ? searchParams.project : ""
  return (
    <WorkbookLayoutBuilder
      coordinatorId={coordinatorId}
      coordinatorName={coordinatorName}
      backProjectId={backProject}
    />
  )
}
