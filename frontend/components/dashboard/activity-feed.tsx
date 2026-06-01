"use client"

import { UserSquare2, FileText, Calendar, AlertTriangle, FileBarChart } from "lucide-react"
import { cn } from "@/lib/utils"

interface Activity {
  type: string
  description: string
  timestamp: string
  user: string
}

interface ActivityFeedProps {
  activities: Activity[]
}

const iconMap: Record<string, { icon: typeof UserSquare2; color: string }> = {
  interaction: { icon: UserSquare2, color: "text-chart-1 bg-chart-1/10" },
  respondent: { icon: UserSquare2, color: "text-chart-2 bg-chart-2/10" },
  event: { icon: Calendar, color: "text-chart-3 bg-chart-3/10" },
  flag: { icon: AlertTriangle, color: "text-chart-5 bg-chart-5/10" },
  report: { icon: FileBarChart, color: "text-chart-4 bg-chart-4/10" },
}

export function ActivityFeed({ activities }: ActivityFeedProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h3 className="mb-4 text-sm font-medium text-muted-foreground">Recent Activity</h3>
      <div className="space-y-4">
        {activities.map((activity, index) => {
          const { icon: Icon, color } = iconMap[activity.type] || { icon: FileText, color: "text-muted-foreground bg-muted" }
          return (
            <div key={index} className="flex items-start gap-3">
              <div className={cn("rounded-lg p-2", color)}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 space-y-1">
                <p className="text-sm text-card-foreground">{activity.description}</p>
                <p className="text-xs text-muted-foreground">
                  {activity.user} &middot; {activity.timestamp}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
