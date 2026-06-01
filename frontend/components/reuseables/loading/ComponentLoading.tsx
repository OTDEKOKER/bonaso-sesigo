"use client"

import React from "react"
import { cn } from "@/lib/utils"

export interface ComponentLoadingProps {
  className?: string
  size?: "sm" | "md" | "lg"
  barCount?: number
}

export function ComponentLoading({
  className,
  size = "md",
  barCount = 4,
}: ComponentLoadingProps) {
  const sizeStyles = {
    sm: { height: "h-4", gap: "gap-0.5", barWidth: "w-1" },
    md: { height: "h-8", gap: "gap-1", barWidth: "w-1.5" },
    lg: { height: "h-12", gap: "gap-1.5", barWidth: "w-2" },
  }

  const { height, gap, barWidth } = sizeStyles[size]

  return (
    <div
      className={cn(
        "flex items-center justify-center",
        height,
        gap,
        className
      )}
    >
      {Array.from({ length: barCount }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "rounded-full bg-primary",
            barWidth,
            height
          )}
          style={{
            animation: `loadingBar 1s ease-in-out ${i * 0.15}s infinite`,
          }}
        />
      ))}
      <style jsx>{`
        @keyframes loadingBar {
          0%, 100% {
            transform: scaleY(0.4);
            opacity: 0.4;
          }
          50% {
            transform: scaleY(1);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  )
}

export default ComponentLoading
