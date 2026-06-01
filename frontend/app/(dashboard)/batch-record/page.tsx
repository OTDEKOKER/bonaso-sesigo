"use client"

import { useRef, useState } from "react"
import { FileSpreadsheet, Download, Upload, Loader2, CheckCircle2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { PageHeader } from "@/components/shared/page-header"
import { Badge } from "@/components/ui/badge"
import { useProjects, useAllOrganizations } from "@/lib/hooks/use-api"
import { uploadsService } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/lib/contexts/auth-context"

const API_BASE = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "https://sesigo.org.bw/api"

function getAccessToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem("access_token")
}

export default function BatchRecordPage() {
  const { toast } = useToast()
  const { user } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: projectsData } = useProjects()
  const { data: orgsData } = useAllOrganizations()

  const projects = projectsData?.results || []
  const organizations = orgsData?.results || []

  const [selectedProject, setSelectedProject] = useState("")
  const [selectedOrg, setSelectedOrg] = useState("")
  const [isDownloading, setIsDownloading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{ status: "success" | "error"; message: string } | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const handleDownloadTemplate = async () => {
    if (!selectedProject) {
      toast({ title: "Select a project first", variant: "destructive" })
      return
    }
    setIsDownloading(true)
    try {
      const token = getAccessToken()
      const params = new URLSearchParams({ project: selectedProject })
      if (selectedOrg) params.append("organization", selectedOrg)
      const url = `${API_BASE}/uploads/download_template/?${params}`
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || "Template download failed")
      }
      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const a = document.createElement("a")
      const project = projects.find((p) => String(p.id) === selectedProject)
      a.href = href
      a.download = `batch_template_${project?.code || selectedProject}.xlsx`
      a.click()
      URL.revokeObjectURL(href)
    } catch (err) {
      toast({ title: "Error", description: String(err instanceof Error ? err.message : err), variant: "destructive" })
    } finally {
      setIsDownloading(false)
    }
  }

  const handleUpload = async () => {
    if (!selectedProject) {
      toast({ title: "Select a project first", variant: "destructive" })
      return
    }
    if (!selectedFile) {
      toast({ title: "Select a file to upload", variant: "destructive" })
      return
    }
    setIsUploading(true)
    setUploadResult(null)
    try {
      const upload = await uploadsService.create({
        name: selectedFile.name,
        file: selectedFile,
        organization: selectedOrg ? Number(selectedOrg) : undefined,
      })
      const job = await uploadsService.startImport(Number(upload.id), { project_id: Number(selectedProject) })
      setUploadResult({
        status: "success",
        message: `Upload queued (job #${job.id}). Data will be processed shortly.`,
      })
      setSelectedFile(null)
      if (fileRef.current) fileRef.current.value = ""
    } catch (err) {
      setUploadResult({
        status: "error",
        message: err instanceof Error ? err.message : "Upload failed. Check the file format and try again.",
      })
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title="Batch Data Entry"
        description="Download pre-filled Excel templates and upload completed workbooks"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Batch Record" },
        ]}
      />

      {/* Step 1 – Project & Org selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Select Scope</CardTitle>
          <CardDescription>Choose the project (and optionally organization) for the template.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Project *</Label>
            <Select value={selectedProject} onValueChange={setSelectedProject}>
              <SelectTrigger>
                <SelectValue placeholder="Select project…" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Organization <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Select value={selectedOrg || "all"} onValueChange={(v) => setSelectedOrg(v === "all" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="All organizations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All organizations</SelectItem>
                {organizations.map((o) => (
                  <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Step 2 – Download template */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Download Template</CardTitle>
          <CardDescription>
            Generate an Excel template pre-loaded with the project&apos;s indicator columns.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleDownloadTemplate} disabled={isDownloading || !selectedProject}>
            {isDownloading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Download Template
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            Fill in the <strong>Data Entry</strong> sheet. Each row is one organization + reporting period.
            Do not rename or add/remove indicator columns.
          </p>
        </CardContent>
      </Card>

      {/* Step 3 – Upload completed workbook */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">3. Upload Completed Workbook</CardTitle>
          <CardDescription>Upload the filled-in Excel file to queue it for data import.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Excel file (.xlsx)</Label>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary hover:file:bg-primary/20"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
            />
            {selectedFile && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <FileSpreadsheet className="h-3.5 w-3.5" /> {selectedFile.name}
              </p>
            )}
          </div>

          <Button onClick={handleUpload} disabled={isUploading || !selectedProject || !selectedFile}>
            {isUploading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Upload &amp; Queue Import
          </Button>

          {uploadResult && (
            <div
              className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                uploadResult.status === "success"
                  ? "border-chart-2/30 bg-chart-2/5 text-chart-2"
                  : "border-destructive/30 bg-destructive/5 text-destructive"
              }`}
            >
              {uploadResult.status === "success" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              {uploadResult.message}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tip */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start gap-3">
            <FileSpreadsheet className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
            <div className="text-sm text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Tips</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Each row represents one organization for one reporting period.</li>
                <li>Reporting period format: <code className="text-xs bg-muted px-1 rounded">2025-Q4</code></li>
                <li>Leave a cell blank if there is no data for that indicator/period.</li>
                <li>After uploading, track import progress on the <strong>Uploads</strong> page.</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
