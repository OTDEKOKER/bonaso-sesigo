export const dynamic = 'force-static';
export function generateStaticParams() { return []; }

import { redirect } from "next/navigation"

export default function AssessmentEditRedirect({
  params,
}: {
  params: { id: string }
}) {
  redirect(`/indicators/assessments/${params.id}`)
}
