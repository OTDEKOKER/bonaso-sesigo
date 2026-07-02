"use client";

import type { ReactNode } from "react";

type ChartHeaderProps = {
  title: string;
  subtitle?: string;
  rightContent?: ReactNode;
};

export function ChartHeader(props: ChartHeaderProps) {
  const { title, subtitle, rightContent } = props;

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="space-y-0.5">
          {/* Single-line title: truncate gracefully, full text on hover. */}
          <h3
            title={title}
            className="truncate text-[15px] font-semibold tracking-[-0.02em] text-foreground sm:text-base"
          >
            {title}
          </h3>
          {subtitle ? (
            <p title={subtitle} className="truncate text-xs leading-5 text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
      {rightContent ? <div className="shrink-0">{rightContent}</div> : null}
    </div>
  );
}
