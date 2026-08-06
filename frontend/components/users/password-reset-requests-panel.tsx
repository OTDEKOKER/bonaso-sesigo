"use client"

import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, KeyRound, Loader2, RefreshCcw, XCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { usersService, type PasswordResetRequestRow } from "@/lib/api"

type StatusTab = "pending" | "approved" | "rejected" | "all"

function formatDateTime(value?: string | null) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function StatusBadge({ status }: { status: PasswordResetRequestRow["status"] }) {
  if (status === "pending") return <Badge variant="secondary">Pending</Badge>
  if (status === "approved") return <Badge className="bg-emerald-600 hover:bg-emerald-600">Approved</Badge>
  return <Badge variant="destructive">Rejected</Badge>
}

/**
 * Admin queue for admin-approved password resets (DPA fallback flow). Lists
 * requests by status; approving sets the account's new password (server resets
 * the expiry clock), rejecting closes the request without changing anything.
 */
export function PasswordResetRequestsPanel() {
  const { toast } = useToast()
  const [status, setStatus] = useState<StatusTab>("pending")
  const [rows, setRows] = useState<PasswordResetRequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)

  // Approve dialog state
  const [approveRow, setApproveRow] = useState<PasswordResetRequestRow | null>(null)
  const [newPassword, setNewPassword] = useState("")
  const [resolutionNote, setResolutionNote] = useState("")
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await usersService.listPasswordResetRequests(status)
      setRows(res.results)
    } catch {
      toast({ title: "Failed to load reset requests", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [status, toast])

  useEffect(() => {
    load()
  }, [load])

  const openApprove = (row: PasswordResetRequestRow) => {
    setApproveRow(row)
    setNewPassword("")
    setResolutionNote("")
    setApproveError("")
  }

  const submitApprove = async () => {
    if (!approveRow) return
    setApproving(true)
    setApproveError("")
    try {
      await usersService.approvePasswordResetRequest(approveRow.id, newPassword, resolutionNote)
      toast({ title: "Password reset", description: `Set a new password for ${approveRow.username}.` })
      setApproveRow(null)
      await load()
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : "Could not approve this request.")
    } finally {
      setApproving(false)
    }
  }

  const reject = async (row: PasswordResetRequestRow) => {
    setBusyId(row.id)
    try {
      await usersService.rejectPasswordResetRequest(row.id)
      toast({ title: "Request rejected" })
      await load()
    } catch (err) {
      toast({
        title: "Could not reject",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" /> Password reset requests
        </CardTitle>
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={(v) => setStatus(v as StatusTab)}>
            <SelectTrigger className="h-9 w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCcw className={"h-4 w-4 " + (loading ? "animate-spin" : "")} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No {status === "all" ? "" : status} requests.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Requested by</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="align-top font-medium">{row.identifier}</TableCell>
                    <TableCell className="align-top">
                      {row.matched ? (
                        <div className="text-sm">
                          <div>{row.username}</div>
                          <div className="text-xs text-muted-foreground">{row.user_email}</div>
                        </div>
                      ) : (
                        <Badge variant="outline" className="text-amber-700">No match</Badge>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <span className="block max-w-[18rem] whitespace-normal break-words text-sm text-muted-foreground">
                        {row.note || "—"}
                      </span>
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      <div>{formatDateTime(row.created_at)}</div>
                      {row.ip_address ? <div className="text-xs">{row.ip_address}</div> : null}
                    </TableCell>
                    <TableCell className="align-top">
                      <StatusBadge status={row.status} />
                      {row.status !== "pending" && row.resolved_by_username ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          by {row.resolved_by_username}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="align-top text-right">
                      {row.status === "pending" ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            onClick={() => openApprove(row)}
                            disabled={!row.matched || busyId === row.id}
                            title={row.matched ? "Set a new password" : "No matching account — reject instead"}
                          >
                            <CheckCircle2 className="mr-1 h-4 w-4" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => reject(row)}
                            disabled={busyId === row.id}
                          >
                            {busyId === row.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <XCircle className="mr-1 h-4 w-4" />
                            )}
                            Reject
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(row.resolved_at)}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Approve dialog: admin sets the account's new password */}
      <Dialog open={!!approveRow} onOpenChange={(o) => !o && setApproveRow(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approve reset for {approveRow?.username}</DialogTitle>
            <DialogDescription>
              Set a new password for this account. Share it with the user through a trusted
              channel; they can change it after signing in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {approveError ? (
              <div className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="alert">
                {approveError}
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="approve-new-pw">New password</Label>
              <Input
                id="approve-new-pw"
                type="text"
                autoComplete="off"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter a temporary password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="approve-note">Note <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                id="approve-note"
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                placeholder="e.g. verified by phone"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveRow(null)} disabled={approving}>
              Cancel
            </Button>
            <Button onClick={submitApprove} disabled={approving || newPassword.length < 8}>
              {approving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Set password & approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
