"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  BookOpen,
  BarChart2,
  Upload,
  Download,
  FolderKanban,
  RefreshCw,
  ClipboardList,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { PageHeader } from "@/components/shared/page-header"
import { useAuth } from "@/lib/contexts/auth-context"
import { useProjects } from "@/lib/hooks/use-api"
import { projectsService } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"
import type { Project } from "@/lib/types"

const TRAINING_PROJECT_NAME = "SESIGO TRAINING PROJECT - DO NOT USE FOR REAL REPORTING"

function TrainingBanner() {
  return (
    <div className="mb-6 rounded-lg border-2 border-amber-400 bg-amber-50 px-6 py-4 dark:bg-amber-950/30">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
        <div>
          <p className="font-semibold text-amber-800 dark:text-amber-300">
            You are working in Sesigo Training Mode
          </p>
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
            Data entered here is for practice only and will not be used for official reporting.
            Training data may be automatically cleared after 7 days.
          </p>
        </div>
      </div>
    </div>
  )
}

function TrainingBadge({ label }: { label: string }) {
  return (
    <Badge className="border border-amber-400 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
      {label}
    </Badge>
  )
}

interface ActionCardProps {
  icon: React.ElementType
  title: string
  description: string
  onClick: () => void
  disabled?: boolean
  variant?: "default" | "destructive"
}

function ActionCard({ icon: Icon, title, description, onClick, disabled, variant = "default" }: ActionCardProps) {
  return (
    <Card
      className={
        "cursor-pointer transition-colors hover:border-primary/50" +
        (disabled ? " pointer-events-none opacity-50" : "") +
        (variant === "destructive" ? " border-red-200 hover:border-red-400" : "")
      }
      onClick={disabled ? undefined : onClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div
            className={
              "flex h-10 w-10 items-center justify-center rounded-lg " +
              (variant === "destructive"
                ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                : "bg-primary/10 text-primary")
            }
          >
            <Icon className="h-5 w-5" />
          </div>
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <CardDescription>{description}</CardDescription>
      </CardContent>
    </Card>
  )
}

export default function TrainingPage() {
  const router = useRouter()
  const { user } = useAuth()
  const { toast } = useToast()
  const { data: projectsData } = useProjects()
  const isAdmin = user?.role === "admin"

  const [showResetDialog, setShowResetDialog] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  const projects: Project[] = Array.isArray(projectsData)
    ? projectsData
    : (projectsData as { results?: Project[] })?.results ?? []

  const trainingProject = projects.find((p) => p.is_training)

  const handleOpenTrainingProject = () => {
    if (trainingProject) {
      router.push(`/projects/${trainingProject.id}`)
    } else {
      router.push("/projects")
    }
  }

  const handlePracticeDataEntry = () => {
    if (trainingProject) {
      router.push(`/aggregates?project=${trainingProject.id}`)
    } else {
      router.push("/aggregates")
    }
  }

  const handleViewTrainingDashboard = () => {
    if (trainingProject) {
      router.push(`/dashboard?project=${trainingProject.id}`)
    } else {
      router.push("/dashboard")
    }
  }

  const handleDownloadTemplate = () => {
    if (trainingProject) {
      router.push(`/uploads?project=${trainingProject.id}`)
    } else {
      router.push("/uploads")
    }
  }

  const handleUploadWorkbook = () => {
    if (trainingProject) {
      router.push(`/uploads?project=${trainingProject.id}`)
    } else {
      router.push("/uploads")
    }
  }

  const handleViewReports = () => {
    if (trainingProject) {
      router.push(`/reports?project=${trainingProject.id}`)
    } else {
      router.push("/reports")
    }
  }

  const handleResetConfirm = async () => {
    if (!trainingProject) return
    setResetLoading(true)
    try {
      await projectsService.trainingReset(trainingProject.id)
      toast({
        title: "Training data reset",
        description: "All Sesigo Training Mode demo data has been cleared. Production data was not touched.",
      })
      setShowResetDialog(false)
    } catch {
      toast({
        title: "Reset failed",
        description: "Could not reset training data. Please try again.",
        variant: "destructive",
      })
    } finally {
      setResetLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sesigo Training Mode"
        description="Practice using the Sesigo Data Portal safely without affecting official Sesigo Live System data."
      >
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap gap-2">
            <TrainingBadge label="TRAINING MODE" />
            <TrainingBadge label="DEMO DATA" />
            <TrainingBadge label="NOT FOR OFFICIAL REPORTING" />
          </div>
          <p className="text-xs text-muted-foreground">Powered by BONASO</p>
        </div>
      </PageHeader>

      <TrainingBanner />

      {trainingProject && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-5 py-3 dark:bg-amber-950/20">
          <p className="text-sm text-amber-800 dark:text-amber-300">
            <span className="font-medium">Active Training Project:</span>{" "}
            <span className="font-semibold">{trainingProject.name}</span>
          </p>
        </div>
      )}

      {!trainingProject && (
        <div className="rounded-lg border border-muted bg-muted/30 px-5 py-3">
          <p className="text-sm text-muted-foreground">
            No training project found. An admin must create a project with{" "}
            <span className="font-mono font-medium">is_training=True</span> named{" "}
            <span className="font-semibold">{TRAINING_PROJECT_NAME}</span>.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ActionCard
          icon={ClipboardList}
          title="Start Practical Data Entry"
          description="Enter aggregate data under the Sesigo Training Project without affecting real reports."
          onClick={handlePracticeDataEntry}
        />
        <ActionCard
          icon={FolderKanban}
          title="Open Sesigo Training Project"
          description="View and manage the Sesigo Training Project — your sandbox for practice exercises."
          onClick={handleOpenTrainingProject}
        />
        <ActionCard
          icon={Download}
          title="Download Training Excel Template"
          description="Download an Excel batch template pre-filled with the Training Project's indicators."
          onClick={handleDownloadTemplate}
        />
        <ActionCard
          icon={Upload}
          title="Upload Training Workbook"
          description="Upload a completed Excel workbook linked to the Sesigo Training Project."
          onClick={handleUploadWorkbook}
        />
        <ActionCard
          icon={BarChart2}
          title="View Sesigo Training Dashboard"
          description="See dashboard output scoped to the Sesigo Training Project only."
          onClick={handleViewTrainingDashboard}
        />
        <ActionCard
          icon={BookOpen}
          title="View Training Reports / Aggregates"
          description="Review aggregate records and reports submitted under the Sesigo Training Project."
          onClick={handleViewReports}
        />
      </div>

      {isAdmin && (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-medium text-muted-foreground">Admin Actions</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ActionCard
              icon={RefreshCw}
              title="Reset Training Data"
              description="Clear all demo data from the Sesigo Training Project. Production data will not be touched."
              onClick={() => setShowResetDialog(true)}
              variant="destructive"
              disabled={!trainingProject}
            />
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-muted/20 px-5 py-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">How Sesigo Training Mode works</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>All data you enter here is linked to the Sesigo Training Project and safely separated from Sesigo Live System data.</li>
          <li>Training data is excluded from official dashboards, reports, and aggregates by default.</li>
          <li>Training data is automatically cleared after 7 days.</li>
          <li>Demo users can only access the Sesigo Training Project and cannot submit to real projects.</li>
          <li>Admins can manually reset training data at any time using the Reset button above.</li>
        </ul>
      </div>

      {/* Reset confirmation dialog */}
      <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Reset Sesigo Training Data
            </DialogTitle>
            <DialogDescription>
              You are about to clear all Sesigo Training Mode demo data only.{" "}
              <strong>Production data will not be touched.</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
            This will permanently delete training aggregate records, narrative reports, tasks,
            deadlines, and activities linked to the Sesigo Training Project. This action cannot
            be undone.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResetDialog(false)} disabled={resetLoading}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleResetConfirm} disabled={resetLoading}>
              {resetLoading ? "Resetting…" : "Yes, reset training data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
