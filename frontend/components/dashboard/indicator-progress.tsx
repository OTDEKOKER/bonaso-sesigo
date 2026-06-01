"use client"

import { Progress } from "@/components/ui/progress"

interface IndicatorProgressProps {
  data: { name: string; target: number; achieved: number }[]
}

export function IndicatorProgress({ data }: IndicatorProgressProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h3 className="mb-4 text-sm font-medium text-muted-foreground">Indicator Progress</h3>
      <div className="space-y-6">
        {data.map((item) => {
          const target = Number(item.target) || 0
          const achieved = Number(item.achieved) || 0
          const percentage = target > 0 ? Math.round((achieved / target) * 100) : 0
          return (
            <div key={item.name} className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-card-foreground">{item.name}</span>
                <span className="text-muted-foreground">
                  {achieved.toLocaleString()} / {target.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Progress value={percentage} className="flex-1" />
                <span className="w-12 text-right text-sm font-medium text-card-foreground">
                  {percentage}%
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
