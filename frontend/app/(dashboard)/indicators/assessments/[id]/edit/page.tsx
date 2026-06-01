import { redirect } from "next/navigation"

export default function AssessmentEditRedirect({
  params,
}: {
  params: { id: string }
}) {
  redirect(`/indicators/assessments/${params.id}`)
}
