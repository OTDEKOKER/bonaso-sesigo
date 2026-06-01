"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function AnalysisExportRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/analysis/reports")
  }, [router])

  return null
}
