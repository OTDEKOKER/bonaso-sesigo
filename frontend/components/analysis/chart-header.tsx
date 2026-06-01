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
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold tracking-[-0.02em] text-foreground sm:text-xl">
            {title}
          </h3>
          {subtitle ? (
            <p className="max-w-4xl text-sm leading-5 text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {rightContent ? <div className="shrink-0">{rightContent}</div> : null}
    </div>
  );
}
