"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, RefreshCcw, Users } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  auditService,
  type ActiveUser,
  type AuditActionOption,
  type AuditEvent,
  type AuditEventFilters,
} from "@/lib/api";

const PAGE_SIZE = 50;
const ANY_ACTION = "__all__";

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function relativeAge(value?: string | null) {
  if (!value) return "never";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function isRecentlyActive(value?: string | null) {
  if (!value) return false;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return false;
  return Date.now() - then < 24 * 60 * 60 * 1000;
}

function ActiveUsersCard() {
  const [users, setUsers] = useState<ActiveUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setUsers(await auditService.listActiveUsers());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load active users.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const recent = useMemo(() => users.filter((u) => isRecentlyActive(u.last_activity)), [users]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" />
          Active users (last 24h)
          {!isLoading ? <Badge variant="secondary">{recent.length}</Badge> : null}
        </CardTitle>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={isLoading}>
          <RefreshCcw className={isLoading ? "mr-2 h-3.5 w-3.5 animate-spin" : "mr-2 h-3.5 w-3.5"} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="text-sm">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : isLoading ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : recent.length === 0 ? (
          <p className="text-muted-foreground">No users have been active in the last 24 hours.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Last activity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      {u.full_name?.trim() ? u.full_name : u.username}
                      <span className="block text-xs text-muted-foreground">@{u.username}</span>
                    </TableCell>
                    <TableCell className="capitalize">{u.role}</TableCell>
                    <TableCell>{u.organization_name || "—"}</TableCell>
                    <TableCell>
                      {formatDateTime(u.last_activity)}
                      <span className="block text-xs text-muted-foreground">
                        {relativeAge(u.last_activity)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AuditLogCard() {
  const { toast } = useToast();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [actions, setActions] = useState<AuditActionOption[]>([]);
  const [action, setAction] = useState<string>(ANY_ACTION);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filters = useMemo<AuditEventFilters>(() => {
    const f: AuditEventFilters = { page: String(page), page_size: String(PAGE_SIZE) };
    if (action !== ANY_ACTION) f.action = action;
    // <input type="datetime-local"> yields e.g. "2026-07-06T14:00"; the backend
    // IsoDateTimeFilter accepts that directly.
    if (dateFrom) f.date_from = dateFrom;
    if (dateTo) f.date_to = dateTo;
    return f;
  }, [page, action, dateFrom, dateTo]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await auditService.listEvents(filters);
      setEvents(data.results);
      setCount(data.count);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the audit log.");
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    auditService
      .listActions()
      .then(setActions)
      .catch(() => setActions([]));
  }, []);

  const onExport = async () => {
    setIsExporting(true);
    try {
      // Export honours the active filters but not pagination (server caps at 50k).
      const exportFilters: AuditEventFilters = { ...filters };
      delete exportFilters.page;
      delete exportFilters.page_size;
      const filename = await auditService.exportCsv(exportFilters);
      toast({ title: "Export started", description: `Saving ${filename}.` });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: err instanceof Error ? err.message : "The audit log could not be exported.",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  const resetFilter = (setter: (v: string) => void) => (value: string) => {
    setPage(1);
    setter(value);
  };

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Audit log</CardTitle>
          <Button variant="outline" size="sm" onClick={() => void onExport()} disabled={isExporting}>
            {isExporting ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-2 h-3.5 w-3.5" />
            )}
            Export CSV
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">Action</Label>
            <Select value={action} onValueChange={resetFilter(setAction)}>
              <SelectTrigger>
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_ACTION}>All actions</SelectItem>
                {actions.map((a) => (
                  <SelectItem key={a.value} value={a.value}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="audit-from">From</Label>
            <Input
              id="audit-from"
              type="datetime-local"
              value={dateFrom}
              onChange={(e) => resetFilter(setDateFrom)(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="audit-to">To</Label>
            <Input
              id="audit-to"
              type="datetime-local"
              value={dateTo}
              onChange={(e) => resetFilter(setDateTo)(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button variant="outline" className="w-full" onClick={() => void load()} disabled={isLoading}>
              <RefreshCcw className={isLoading ? "mr-2 h-3.5 w-3.5 animate-spin" : "mr-2 h-3.5 w-3.5"} />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Object</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No audit events match these filters.
                  </TableCell>
                </TableRow>
              ) : (
                events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap">{formatDateTime(e.created_at)}</TableCell>
                    <TableCell className="font-medium">{e.actor_display}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {e.action.replaceAll("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {e.object_type ? `${e.object_type}${e.object_id ? `:${e.object_id}` : ""}` : "—"}
                      {e.description ? (
                        <span className="block text-xs">{e.description}</span>
                      ) : null}
                    </TableCell>
                    <TableCell>{e.organization_name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{e.ip_address || "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between gap-4 pt-1">
          <p className="text-xs text-muted-foreground">
            {count.toLocaleString()} event{count === 1 ? "" : "s"} · page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isLoading}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isLoading}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Admin-only "Activity" panel for the Users page: recently-active users plus the
 * full, filterable audit trail (who did what, when, from where) with CSV export.
 * All data comes from admin-gated read-only endpoints.
 */
export function UserActivityPanel() {
  return (
    <div className="space-y-6">
      <ActiveUsersCard />
      <AuditLogCard />
    </div>
  );
}
