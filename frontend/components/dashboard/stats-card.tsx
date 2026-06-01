import { type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface StatsCardProps {
  title: string
  value: string | number
  change?: {
    value: number
    label: string
  }
  icon: LucideIcon
  iconColor?: string
}

export function StatsCard({ title, value, change, icon: Icon, iconColor = "text-primary" }: StatsCardProps) {
  const isPositive = change && change.value >= 0

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-3xl font-bold text-card-foreground">{value}</p>
          {change && (
            <p className={cn(
              "text-sm",
              isPositive ? "text-primary" : "text-destructive"
            )}>
              <span>{isPositive ? "+" : ""}{change.value}%</span>
              <span className="ml-1 text-muted-foreground">{change.label}</span>
            </p>
          )}
        </div>
        <div className={cn("rounded-lg bg-secondary p-3", iconColor)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}
