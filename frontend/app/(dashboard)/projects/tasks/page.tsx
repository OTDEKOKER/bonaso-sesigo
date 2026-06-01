"use client"

import { useRouter } from "next/navigation"
import { Plus, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/shared/page-header"
import { DataTable } from "@/components/shared/data-table"
import { useTasks } from "@/lib/hooks/use-api"
import type { Task } from "@/lib/types"

const statusColors: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  in_progress: "bg-primary/10 text-primary",
  completed: "bg-chart-2/10 text-chart-2",
  cancelled: "bg-destructive/10 text-destructive",
}

const priorityColors: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-primary/10 text-primary",
  high: "bg-chart-3/10 text-chart-3",
  urgent: "bg-destructive/10 text-destructive",
}

export default function TasksPage() {
  const router = useRouter()
  const { data, isLoading, error, mutate } = useTasks()
  const tasks = data?.results || []

  const columns = [
    {
      key: "name",
      label: "Task",
      sortable: true,
      render: (task: Task) => {
        return (
          <div>
            <p className="font-medium text-foreground">{task.name}</p>
            <p className="text-xs text-muted-foreground">{task.project_name || "—"}</p>
          </div>
        )
      }
    },
    {
      key: "project",
      label: "Project",
      render: (task: Task) => {
        return (
          <div>
            <p className="text-sm text-foreground">{task.project_name || "—"}</p>
            <p className="text-xs text-muted-foreground">ID: {task.project}</p>
          </div>
        )
      }
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (task: Task) => (
        <Badge variant="secondary" className={statusColors[task.status]}>
          {task.status.replace('_', ' ')}
        </Badge>
      )
    },
    {
      key: "priority",
      label: "Priority",
      render: (task: Task) => (
        <Badge variant="secondary" className={priorityColors[task.priority]}>
          {task.priority}
        </Badge>
      )
    },
    {
      key: "due_date",
      label: "Due Date",
      render: (task: Task) => (
        <span className="text-sm text-muted-foreground">
          {task.due_date ? new Date(task.due_date).toLocaleDateString() : "—"}
        </span>
      )
    }
  ]

  const actions = (task: Task) => [
    { label: "View Details", onClick: () => router.push(`/projects/${task.project}`) },
  ]

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Failed to load tasks</p>
        <Button onClick={() => mutate()}>Retry</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tasks"
        description="View and manage all tasks across projects"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Projects", href: "/projects" },
          { label: "Tasks" },
        ]}
        actions={
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Batch Create Tasks
          </Button>
        }
      />

      {/* Summary stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Total Tasks</p>
          <p className="text-2xl font-bold text-foreground">{tasks.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">In Progress</p>
          <p className="text-2xl font-bold text-primary">
            {tasks.filter(t => t.status === 'in_progress').length}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Completed</p>
          <p className="text-2xl font-bold text-chart-2">
            {tasks.filter(t => t.status === 'completed').length}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Pending</p>
          <p className="text-2xl font-bold text-muted-foreground">
            {tasks.filter(t => t.status === 'pending').length}
          </p>
        </div>
      </div>

      <DataTable
        data={tasks}
        columns={columns}
        searchPlaceholder="Search tasks..."
        actions={actions}
      />
    </div>
  )
}
