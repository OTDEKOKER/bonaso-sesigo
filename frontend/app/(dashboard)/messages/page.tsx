"use client"

import { useState, useMemo } from "react"
import {
  Mail, Send, Inbox, Plus, Search, Check, CheckCheck, Trash2, Reply, Loader2,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/components/shared/page-header"

import { useMessages, useUsers } from "@/lib/hooks/use-api"
import { messagesService } from "@/lib/api"
import { useAuth } from "@/lib/contexts/auth-context"
import { useToast } from "@/hooks/use-toast"
import type { Message } from "@/lib/types"

const TYPE_LABELS: Record<string, string> = {
  message: "Message",
  notification: "Notification",
  alert: "Alert",
  reminder: "Reminder",
}

function formatDate(value?: string) {
  if (!value) return "—"
  return new Date(value).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  })
}

function MessageRow({
  msg,
  isSent,
  onOpen,
}: {
  msg: Message
  isSent: boolean
  onOpen: (m: Message) => void
}) {
  const label = isSent ? msg.recipient_name || String(msg.recipient) : msg.sender_name || "System"
  return (
    <button
      type="button"
      onClick={() => onOpen(msg)}
      className={`w-full rounded-lg border px-4 py-3 text-left transition hover:bg-muted/40 ${
        !isSent && !msg.is_read ? "border-primary/40 bg-primary/5 font-medium" : "border-border bg-background"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {!isSent && !msg.is_read && (
              <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
            )}
            <span className="truncate text-sm font-medium">{label}</span>
            <Badge variant="outline" className="shrink-0 text-xs">
              {TYPE_LABELS[msg.message_type] || msg.message_type}
            </Badge>
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{msg.subject}</p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{formatDate(msg.created_at)}</span>
      </div>
    </button>
  )
}

export default function MessagesPage() {
  const { toast } = useToast()
  const { user: currentUser } = useAuth()

  const [tab, setTab] = useState<"inbox" | "sent">("inbox")
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<Message | null>(null)
  const [isComposing, setIsComposing] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [draft, setDraft] = useState({
    recipientId: "",
    subject: "",
    content: "",
    message_type: "message" as "message" | "notification" | "alert" | "reminder",
  })

  const { data: inbox = [], isLoading: inboxLoading, mutate: mutateInbox } = useMessages("inbox")
  const { data: sent = [], isLoading: sentLoading, mutate: mutateSent } = useMessages("sent")
  const { data: usersData } = useUsers({ page_size: "200" })

  const recipients = useMemo(
    () => (usersData?.results || []).filter((u) => String(u.id) !== String(currentUser?.id)),
    [usersData, currentUser],
  )

  const unreadCount = useMemo(() => inbox.filter((m) => !m.is_read).length, [inbox])

  const messages = tab === "inbox" ? inbox : sent
  const isLoading = tab === "inbox" ? inboxLoading : sentLoading

  const filtered = useMemo(() => {
    if (!search.trim()) return messages
    const q = search.toLowerCase()
    return messages.filter(
      (m) =>
        m.subject.toLowerCase().includes(q) ||
        m.content.toLowerCase().includes(q) ||
        (m.sender_name || "").toLowerCase().includes(q) ||
        (m.recipient_name || "").toLowerCase().includes(q),
    )
  }, [messages, search])

  const handleOpen = async (msg: Message) => {
    setSelected(msg)
    if (tab === "inbox" && !msg.is_read) {
      try {
        await messagesService.markRead(Number(msg.id))
        mutateInbox()
      } catch {
        // silent
      }
    }
  }

  const handleMarkAllRead = async () => {
    try {
      await messagesService.markAllRead()
      mutateInbox()
      toast({ title: "All messages marked as read" })
    } catch {
      toast({ title: "Error", description: "Could not mark all as read.", variant: "destructive" })
    }
  }

  const handleDelete = async (msg: Message) => {
    try {
      await messagesService.delete(Number(msg.id))
      setSelected(null)
      if (tab === "inbox") mutateInbox(); else mutateSent()
      toast({ title: "Message deleted" })
    } catch {
      toast({ title: "Error", description: "Could not delete message.", variant: "destructive" })
    }
  }

  const handleSend = async () => {
    if (!draft.recipientId) {
      toast({ title: "Select a recipient", variant: "destructive" })
      return
    }
    if (!draft.subject.trim()) {
      toast({ title: "Subject is required", variant: "destructive" })
      return
    }
    if (!draft.content.trim()) {
      toast({ title: "Message body is required", variant: "destructive" })
      return
    }
    setIsSending(true)
    try {
      await messagesService.send({
        recipient: Number(draft.recipientId),
        subject: draft.subject.trim(),
        content: draft.content.trim(),
        message_type: draft.message_type,
      })
      mutateSent()
      setIsComposing(false)
      setDraft({ recipientId: "", subject: "", content: "", message_type: "message" })
      toast({ title: "Message sent" })
    } catch {
      toast({ title: "Error", description: "Could not send message.", variant: "destructive" })
    } finally {
      setIsSending(false)
    }
  }

  const openReply = (msg: Message) => {
    setDraft({
      recipientId: String(msg.sender || ""),
      subject: msg.subject.startsWith("Re:") ? msg.subject : `Re: ${msg.subject}`,
      content: "",
      message_type: "message",
    })
    setSelected(null)
    setIsComposing(true)
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title="Messages"
        description="Send and receive messages with other portal users"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Messages" },
        ]}
        actions={
          <Button onClick={() => setIsComposing(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Compose
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.6fr]">
        {/* List panel */}
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search messages…"
              className="pl-9"
            />
          </div>

          <Tabs value={tab} onValueChange={(v) => { setTab(v as "inbox" | "sent"); setSelected(null) }}>
            <TabsList className="w-full">
              <TabsTrigger value="inbox" className="flex-1">
                <Inbox className="mr-1.5 h-4 w-4" />
                Inbox
                {unreadCount > 0 && (
                  <Badge className="ml-2 h-5 min-w-[1.25rem] px-1 text-xs">{unreadCount}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="sent" className="flex-1">
                <Send className="mr-1.5 h-4 w-4" />
                Sent
              </TabsTrigger>
            </TabsList>

            <TabsContent value="inbox" className="mt-3 space-y-2">
              {tab === "inbox" && unreadCount > 0 && (
                <Button variant="ghost" size="sm" className="w-full text-xs" onClick={handleMarkAllRead}>
                  <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
                  Mark all as read
                </Button>
              )}
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : filtered.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {search ? "No messages match your search." : "Your inbox is empty."}
                </p>
              ) : (
                filtered.map((m) => (
                  <MessageRow key={m.id} msg={m} isSent={false} onOpen={handleOpen} />
                ))
              )}
            </TabsContent>

            <TabsContent value="sent" className="mt-3 space-y-2">
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : filtered.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {search ? "No messages match your search." : "No sent messages."}
                </p>
              ) : (
                filtered.map((m) => (
                  <MessageRow key={m.id} msg={m} isSent={true} onOpen={handleOpen} />
                ))
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* Detail panel */}
        <div>
          {selected ? (
            <Card>
              <CardHeader className="border-b bg-muted/20 pb-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <CardTitle className="text-base">{selected.subject}</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {tab === "inbox"
                        ? `From: ${selected.sender_name || "System"}`
                        : `To: ${selected.recipient_name || selected.recipient}`}
                      {" · "}
                      {formatDate(selected.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {tab === "inbox" && (
                      <Button variant="ghost" size="icon" title="Reply" onClick={() => openReply(selected)}>
                        <Reply className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Delete"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(selected)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{selected.content}</p>
                {tab === "inbox" && selected.is_read && (
                  <p className="mt-4 flex items-center gap-1 text-xs text-muted-foreground">
                    <Check className="h-3 w-3" /> Read {selected.read_at ? formatDate(selected.read_at) : ""}
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-border">
              <div className="text-center">
                <Mail className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">Select a message to read it</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Compose Dialog */}
      <Dialog open={isComposing} onOpenChange={setIsComposing}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Message</DialogTitle>
            <DialogDescription>Send a message to another user in the system.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>To</Label>
              <Select value={draft.recipientId} onValueChange={(v) => setDraft((d) => ({ ...d, recipientId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select recipient…" />
                </SelectTrigger>
                <SelectContent>
                  {recipients.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={draft.message_type}
                onValueChange={(v) => setDraft((d) => ({ ...d, message_type: v as typeof draft.message_type }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="message">Message</SelectItem>
                  <SelectItem value="notification">Notification</SelectItem>
                  <SelectItem value="alert">Alert</SelectItem>
                  <SelectItem value="reminder">Reminder</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Subject</Label>
              <Input
                value={draft.subject}
                onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
                placeholder="Enter subject…"
              />
            </div>

            <div className="space-y-2">
              <Label>Message</Label>
              <Textarea
                value={draft.content}
                onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
                placeholder="Write your message…"
                rows={5}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsComposing(false)} disabled={isSending}>
              Cancel
            </Button>
            <Button onClick={handleSend} disabled={isSending}>
              {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
