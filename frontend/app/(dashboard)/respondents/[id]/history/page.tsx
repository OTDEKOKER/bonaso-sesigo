export const dynamic = 'force-static';
export function generateStaticParams() { return []; }

import { redirect } from "next/navigation"

export default function RespondentHistoryRedirect({
  params,
}: {
  params: { id: string }
}) {
  redirect(`/respondents/${params.id}`)
}
