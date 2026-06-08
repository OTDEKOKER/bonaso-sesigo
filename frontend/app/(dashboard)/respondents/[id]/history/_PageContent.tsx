import { redirect } from "next/navigation"

export default function RespondentHistoryRedirect({
  params,
}: {
  params: { id: string }
}) {
  redirect(`/respondents/${params.id}`)
}
