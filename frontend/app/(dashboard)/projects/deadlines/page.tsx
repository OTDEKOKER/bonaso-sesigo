"use client"

import { useState } from "react"
import { Plus, CheckCircle2, Clock, AlertCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/shared/page-header"
import { useDeadlines } from "@/lib/hooks/use-api"
import { deadlinesService } from "@/lib/api"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

export default function DeadlinesPage() {
  const [activeTab, setActiveTab] = useState("upcoming")
  const { data, isLoading, error, mutate } = useDeadlines()
  const deadlinesAll = data?.results || []

  const now = new Date()
  
  const upcomingDeadlines = deadlinesAll
    .filter(d => d.status === "pending" && new Date(d.due_date) >= now)
    .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())
  
  const overdueDeadlines = deadlinesAll
    .filter(d => d.status === "overdue" || (d.status === "pending" && new Date(d.due_date) < now))
  
  const completedDeadlines = deadlinesAll
    .filter(d => d.status === "submitted" || d.status === "approved")

  const getDeadlines = () => {
    switch (activeTab) {
      case "upcoming":
        return upcomingDeadlines
      case "overdue":
        return overdueDeadlines
      case "completed":
        return completedDeadlines
      default:
        return deadlinesAll
    }
  }

  const deadlines = getDeadlines()

  const handleSubmit = async (id: string) => {
    try {
      await deadlinesService.submit(Number(id))
      mutate()
    } catch (err) {
      console.error("Failed to submit deadline", err)
    }
  }

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
        <p className="text-muted-foreground">Failed to load deadlines</p>
        <Button onClick={() => mutate()}>Retry</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deadlines"
        description="Track project deadlines and milestones"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Projects", href: "/projects" },
          { label: "Deadlines" },
        ]}
        actions={
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add Deadline
          </Button>
        }
      />

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-primary/10 p-2">
              <Clock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Upcoming</p>
              <p className="text-2xl font-bold text-foreground">{upcomingDeadlines.length}</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-destructive/10 p-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Overdue</p>
              <p className="text-2xl font-bold text-destructive">{overdueDeadlines.length}</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-chart-2/10 p-2">
              <CheckCircle2 className="h-5 w-5 text-chart-2" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Completed</p>
              <p className="text-2xl font-bold text-chart-2">{completedDeadlines.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-secondary">
          <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
          <TabsTrigger value="overdue">Overdue</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-6">
          {deadlines.length === 0 ? (
            <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border">
              <p className="text-muted-foreground">No deadlines found</p>
            </div>
          ) : (
            <div className="space-y-3">
              {deadlines.map((deadline) => {
                const dueDate = new Date(deadline.due_date)
                const dueTime = dueDate.getTime()
                const hasDate = Number.isFinite(dueTime)
                const isCompleted = deadline.status === "submitted" || deadline.status === "approved"
                const isPast = hasDate && dueDate < now && !isCompleted
                const daysUntil = hasDate
                  ? Math.ceil((dueTime - now.getTime()) / (1000 * 60 * 60 * 24))
                  : null

                return (
                  <div
                    key={deadline.id}
                    className={cn(
                      "flex items-center justify-between rounded-lg border bg-card p-4 transition-colors",
                      isPast ? "border-destructive/30" : "border-border"
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "rounded-full p-2",
                        isCompleted ? "bg-chart-2/10 text-chart-2" :
                        isPast ? "bg-destructive/10 text-destructive" :
                        "bg-primary/10 text-primary"
                      )}>
                        {isCompleted ? (
                          <CheckCircle2 className="h-5 w-5" />
                        ) : isPast ? (
                          <AlertCircle className="h-5 w-5" />
                        ) : (
                          <Clock className="h-5 w-5" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{deadline.name}</p>
                        {deadline.description && (
                          <p className="text-sm text-muted-foreground">{deadline.description}</p>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {deadline.project_name || "Project"} (ID: {deadline.project})
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-sm text-foreground">
                          {dueDate.toLocaleDateString('en-US', { 
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </p>
                        {!isCompleted && (
                          <Badge variant="secondary" className={cn(
                            "mt-1",
                            isPast ? "bg-destructive/10 text-destructive" :
                            (daysUntil !== null && daysUntil <= 7) ? "bg-chart-3/10 text-chart-3" :
                            "bg-muted text-muted-foreground"
                          )}>
                            {isPast ? 'Overdue' : 
                             daysUntil === null ? 'No date' :
                             daysUntil === 0 ? 'Due today' :
                             daysUntil === 1 ? 'Due tomorrow' :
                             `${daysUntil} days left`}
                          </Badge>
                        )}
                        {isCompleted && (
                          <Badge variant="secondary" className="mt-1 bg-chart-2/10 text-chart-2">
                            Completed
                          </Badge>
                        )}
                      </div>
                      {!isCompleted && (
                        <Button variant="outline" size="sm" onClick={() => handleSubmit(deadline.id)}>
                          Mark Complete
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
