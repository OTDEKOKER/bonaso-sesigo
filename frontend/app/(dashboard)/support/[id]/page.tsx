"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2, Lock, Clock, AlertTriangle } from "lucide-react";
import {
  supportService,
  SUPPORT_STATUSES,
  SUPPORT_SEVERITIES,
  SUPPORT_PRIORITIES,
  type SupportTicket,
  type SupportComment,
  type SupportHistoryEvent,
  type SupportStatus,
} from "@/lib/api";
import { useUsers } from "@/lib/hooks/use-api";
import { useAuth } from "@/lib/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";

const STAFF_ROLES = ["admin", "manager", "officer"];

export default function SupportTicketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();

  const ticketId = Number(Array.isArray(params.id) ? params.id[0] : params.id);
  const isStaff = !!user && STAFF_ROLES.includes(String(user.role));

  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [comments, setComments] = useState<SupportComment[]>([]);
  const [history, setHistory] = useState<SupportHistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [internalNote, setInternalNote] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState("");

  const { data: userData } = useUsers(isStaff ? { page_size: "500" } : undefined);
  const staffUsers = useMemo(
    () => (userData?.results ?? []).filter((u) => STAFF_ROLES.includes(String(u.role))),
    [userData],
  );

  const load = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    try {
      const [t, c, h] = await Promise.all([
        supportService.get(ticketId),
        supportService.listComments(ticketId).catch(() => []),
        supportService.history(ticketId).catch(() => []),
      ]);
      setTicket(t);
      setComments(c);
      setHistory(h);
    } catch (err) {
      toast({
        title: "Could not load ticket",
        description: err instanceof Error ? err.message : "It may not exist or you may not have access.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [ticketId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>, successMsg: string) => {
    setBusy(true);
    try {
      await fn();
      await load();
      toast({ title: successMsg });
    } catch (err) {
      toast({
        title: "Action failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const addComment = async () => {
    if (!commentText.trim()) return;
    await run(async () => {
      await supportService.addComment(ticketId, commentText.trim(), internalNote && isStaff);
      setCommentText("");
      setInternalNote(false);
    }, "Comment added");
  };

  const isReporter = !!user && ticket?.reporter != null && String(ticket.reporter) === String(user.id);
  const canReopen = ticket && ["resolved", "closed"].includes(ticket.status) && (isStaff || isReporter);
  const canClose = ticket && ticket.status === "resolved" && (isStaff || isReporter);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
      </div>
    );
  }
  if (!ticket) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => router.push("/support")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Support
        </Button>
        <p className="text-muted-foreground">Ticket not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" onClick={() => router.push("/support")}>
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to Support
      </Button>

      <PageHeader
        title={`#${ticket.id} · ${ticket.title}`}
        description={`Reported by ${ticket.reporter_name ?? ticket.reporter_username ?? "unknown"} on ${new Date(
          ticket.created_at,
        ).toLocaleString()}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{ticket.status_display}</Badge>
          <Badge variant="secondary">{ticket.severity_display} severity</Badge>
          <Badge variant="secondary">{ticket.priority_display} priority</Badge>
          {ticket.is_overdue && (
            <Badge className="bg-red-100 text-red-800" variant="secondary">
              <AlertTriangle className="mr-1 h-3 w-3" /> Overdue
            </Badge>
          )}
        </div>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent className="whitespace-pre-wrap text-sm">{ticket.description}</CardContent>
          </Card>

          {ticket.resolution_notes && (
            <Card>
              <CardHeader>
                <CardTitle>Resolution</CardTitle>
              </CardHeader>
              <CardContent className="whitespace-pre-wrap text-sm">
                {ticket.resolution_notes}
                {ticket.resolved_at && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Resolved {new Date(ticket.resolved_at).toLocaleString()}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Conversation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {comments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No comments yet.</p>
              ) : (
                comments.map((c) => (
                  <div key={c.id} className="rounded-md border p-3 text-sm">
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {c.created_by_name ?? c.created_by_username ?? "User"}
                      </span>
                      <span>{new Date(c.created_at).toLocaleString()}</span>
                      {c.is_internal && (
                        <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
                          <Lock className="mr-1 h-3 w-3" /> Internal
                        </Badge>
                      )}
                    </div>
                    <div className="whitespace-pre-wrap">{c.content}</div>
                  </div>
                ))
              )}
              <div className="space-y-2 border-t pt-4">
                <Textarea
                  placeholder="Add a comment…"
                  value={commentText}
                  rows={3}
                  onChange={(e) => setCommentText(e.target.value)}
                />
                <div className="flex items-center justify-between">
                  {isStaff ? (
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Checkbox
                        checked={internalNote}
                        onCheckedChange={(v) => setInternalNote(!!v)}
                      />
                      Internal note (hidden from reporter)
                    </label>
                  ) : (
                    <span />
                  )}
                  <Button onClick={addComment} disabled={busy || !commentText.trim()}>
                    {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Comment
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">No history yet.</p>
              ) : (
                <ol className="space-y-3">
                  {history.map((e) => (
                    <li key={e.id} className="flex gap-3 text-sm">
                      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div>
                        <div>{e.description}</div>
                        <div className="text-xs text-muted-foreground">
                          {e.actor} · {new Date(e.created_at).toLocaleString()}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Detail label="Category" value={ticket.category_display} />
              <Detail label="Organisation" value={ticket.affected_organization_name ?? "—"} />
              <Detail label="Project" value={ticket.affected_project_name ?? "—"} />
              <Detail
                label="Reporting period"
                value={ticket.reporting_period_label || "—"}
              />
              <Detail label="Assignee" value={ticket.assigned_to_name ?? "Unassigned"} />
              <Detail label="Reference" value={ticket.related_reference || "—"} />
              {ticket.resolution_target_at && (
                <Detail
                  label="Resolution target"
                  value={new Date(ticket.resolution_target_at).toLocaleString()}
                />
              )}
            </CardContent>
          </Card>

          {isStaff && (
            <Card>
              <CardHeader>
                <CardTitle>Manage</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-xs">Status</Label>
                  <Select
                    value={ticket.status}
                    onValueChange={(v) =>
                      run(() => supportService.setStatus(ticketId, v as SupportStatus), "Status updated")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SUPPORT_STATUSES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Assignee</Label>
                  <Select
                    value={ticket.assigned_to ? String(ticket.assigned_to) : "none"}
                    onValueChange={(v) =>
                      run(
                        () => supportService.assign(ticketId, v === "none" ? null : Number(v)),
                        "Assignment updated",
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {staffUsers.map((u) => (
                        <SelectItem key={u.id} value={String(u.id)}>
                          {u.username}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Severity</Label>
                    <Select
                      value={ticket.severity}
                      onValueChange={(v) =>
                        run(
                          () => supportService.setPriority(ticketId, { severity: v as SupportTicket["severity"] }),
                          "Severity updated",
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SUPPORT_SEVERITIES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Priority</Label>
                    <Select
                      value={ticket.priority}
                      onValueChange={(v) =>
                        run(
                          () => supportService.setPriority(ticketId, { priority: v as SupportTicket["priority"] }),
                          "Priority updated",
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SUPPORT_PRIORITIES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {ticket.status !== "resolved" && ticket.status !== "closed" && (
                  <div className="space-y-2 border-t pt-3">
                    <Label className="text-xs">Resolution notes</Label>
                    <Textarea
                      rows={3}
                      value={resolutionNotes}
                      onChange={(e) => setResolutionNotes(e.target.value)}
                      placeholder="How was it resolved?"
                    />
                    <Button
                      className="w-full"
                      onClick={() =>
                        run(async () => {
                          await supportService.resolve(ticketId, resolutionNotes.trim());
                          setResolutionNotes("");
                        }, "Ticket resolved")
                      }
                      disabled={busy}
                    >
                      Mark resolved
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {(canReopen || canClose) && (
            <Card>
              <CardHeader>
                <CardTitle>Your actions</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {canClose && (
                  <Button
                    variant="outline"
                    onClick={() => run(() => supportService.setStatus(ticketId, "closed"), "Ticket closed")}
                    disabled={busy}
                  >
                    Accept &amp; close
                  </Button>
                )}
                {canReopen && (
                  <Button
                    variant="outline"
                    onClick={() => run(() => supportService.reopen(ticketId), "Ticket reopened")}
                    disabled={busy}
                  >
                    Reopen
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
