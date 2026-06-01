"use client";

import { useEffect, useMemo, useState } from "react";
import type React from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  DownloadCloud,
  HardDrive,
  RefreshCcw,
  Server,
  ShieldCheck,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/shared/page-header";
import { systemService, type SystemHealthStatus, type SystemStatusResponse } from "@/lib/api";

function formatBytes(value?: number | null) {
  if (!value || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatAge(hours?: number | null) {
  if (hours === null || hours === undefined) return "Unknown";
  if (hours < 1) return `${Math.round(hours * 60)} min ago`;
  if (hours < 48) return `${hours.toFixed(1)} hours ago`;
  return `${(hours / 24).toFixed(1)} days ago`;
}

function formatDate(value?: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function statusVariant(status: SystemHealthStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "ok") return "default";
  if (status === "warning") return "secondary";
  if (status === "missing") return "outline";
  return "destructive";
}

function statusLabel(status: SystemHealthStatus) {
  if (status === "ok") return "Healthy";
  if (status === "warning") return "Needs attention";
  if (status === "missing") return "Missing";
  return "Problem";
}

function StatusBadge({ status }: { status: SystemHealthStatus }) {
  return (
    <Badge variant={statusVariant(status)} className="capitalize">
      {statusLabel(status)}
    </Badge>
  );
}

function StatCard({
  title,
  value,
  detail,
  icon,
}: {
  title: string;
  value: string | number;
  detail?: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {icon}
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-semibold tracking-tight">{value}</p>
          {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ServiceCard({
  title,
  status,
  icon,
  children,
}: {
  title: string;
  status: SystemHealthStatus;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
        <StatusBadge status={status} />
      </CardHeader>
      <CardContent className="space-y-3 text-sm">{children}</CardContent>
    </Card>
  );
}

export default function SystemStatusPage() {
  const [status, setStatus] = useState<SystemStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = async () => {
    setIsLoading(true);
    setError(null);
    try {
      setStatus(await systemService.getStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load system status.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const paritySummary = status?.parity.summary ?? {};
  const comparedPayloads = Number(paritySummary.payloads_compared ?? 0);
  const parityMismatches = Number(paritySummary.payload_mismatches ?? 0);

  const importTotal = useMemo(() => {
    if (!status?.import_jobs) return 0;
    return Object.values(status.import_jobs).reduce((total, value) => total + Number(value || 0), 0);
  }, [status?.import_jobs]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Status"
        description="Operational health for backups, parity checks, database, disk, and imports."
        actions={
          <Button onClick={() => void loadStatus()} disabled={isLoading} variant="outline">
            <RefreshCcw className={isLoading ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
            Refresh
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Unable to load system status</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {isLoading && !status ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <RefreshCcw className="h-4 w-4 animate-spin" />
            Checking production health...
          </CardContent>
        </Card>
      ) : null}

      {status ? (
        <>
          <Card className="overflow-hidden border-primary/20">
            <CardContent className="grid gap-5 p-6 md:grid-cols-[1.4fr_1fr]">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  {status.status === "ok" ? (
                    <CheckCircle2 className="h-6 w-6 text-primary" />
                  ) : (
                    <AlertTriangle className="h-6 w-6 text-destructive" />
                  )}
                  <h2 className="text-xl font-semibold">Overall system is {statusLabel(status.status).toLowerCase()}</h2>
                  <StatusBadge status={status.status} />
                </div>
                <p className="text-sm text-muted-foreground">
                  Last checked {formatDate(status.checked_at)}. This page reads the live backend, not cached frontend data.
                </p>
              </div>
              <div className="rounded-xl bg-muted p-4 text-sm">
                <p className="font-medium">Warnings</p>
                {status.warnings.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                    {status.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-muted-foreground">No active warnings.</p>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Aggregates" value={status.counts.aggregates ?? 0} detail="Rows in aggregate table" icon={<Activity className="h-5 w-5" />} />
            <StatCard title="Organizations" value={status.counts.organizations ?? 0} detail="Configured organization records" icon={<Server className="h-5 w-5" />} />
            <StatCard title="Users" value={status.counts.users ?? 0} detail="Portal user accounts" icon={<ShieldCheck className="h-5 w-5" />} />
            <StatCard title="Import Jobs" value={importTotal} detail={`${status.import_jobs.failed || 0} failed`} icon={<DownloadCloud className="h-5 w-5" />} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <ServiceCard title="Database" status={status.database.status} icon={<Database className="h-4 w-4" />}>
              <div className="grid gap-2">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Engine</span>
                  <span className="font-medium">{status.database.engine}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Database</span>
                  <span className="font-medium">{status.database.name}</span>
                </div>
              </div>
            </ServiceCard>

            <ServiceCard title="Database Backup" status={status.backup.status} icon={<ShieldCheck className="h-4 w-4" />}>
              <div className="grid gap-2">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Latest backup</span>
                  <span className="font-medium">{formatAge(status.backup.age_hours)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Verification</span>
                  <span className="font-medium">{status.backup.manifest?.verify_status ?? "Unknown"}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Size</span>
                  <span className="font-medium">{formatBytes(status.backup.manifest?.size_bytes)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Retention</span>
                  <span className="font-medium">{status.backup.manifest?.retention_days ?? "?"} days</span>
                </div>
              </div>
            </ServiceCard>

            <ServiceCard title="Workbook Parity" status={status.parity.status} icon={<Clock3 className="h-4 w-4" />}>
              <div className="grid gap-2">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Latest check</span>
                  <span className="font-medium">{formatAge(status.parity.age_hours)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Payloads compared</span>
                  <span className="font-medium">{comparedPayloads}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Mismatches</span>
                  <span className="font-medium">{parityMismatches}</span>
                </div>
              </div>
            </ServiceCard>

            <ServiceCard title="Disk" status={status.disk.status} icon={<HardDrive className="h-4 w-4" />}>
              <div className="space-y-3">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Used</span>
                  <span className="font-medium">{status.disk.used_percent}%</span>
                </div>
                <Progress value={status.disk.used_percent} />
                <div className="flex justify-between gap-4 text-xs text-muted-foreground">
                  <span>{formatBytes(status.disk.used_bytes)} used</span>
                  <span>{formatBytes(status.disk.free_bytes)} free</span>
                </div>
              </div>
            </ServiceCard>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Import Job Queue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {Object.entries(status.import_jobs).map(([key, value]) => (
                  <div key={key} className="rounded-lg border p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{key.replaceAll("_", " ")}</p>
                    <p className="mt-1 text-2xl font-semibold">{value}</p>
                  </div>
                ))}
              </div>
              <Separator className="my-4" />
              <p className="text-xs text-muted-foreground">
                This page is intentionally read-only. It gives admins a quick way to confirm backups, parity, and operational health before users report problems.
              </p>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
