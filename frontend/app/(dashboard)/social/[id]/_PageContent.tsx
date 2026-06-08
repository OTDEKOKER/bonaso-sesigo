"use client"

import { useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft, Loader2, ExternalLink, Eye, ThumbsUp, MessageCircle, Share2,
  BarChart3, Edit, Save, Building2, Tag, CalendarDays,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PageHeader } from "@/components/shared/page-header"

import { useSocialPost } from "@/lib/hooks/use-api"
import { socialPostsService } from "@/lib/api"
import { useAuth } from "@/lib/contexts/auth-context"
import { useToast } from "@/hooks/use-toast"
import { useSmartBack } from "@/lib/hooks/use-smart-back"

const PLATFORM_COLORS: Record<string, string> = {
  facebook: "border-blue-300 bg-blue-50 text-blue-700",
  instagram: "border-pink-300 bg-pink-50 text-pink-700",
  twitter: "border-sky-300 bg-sky-50 text-sky-700",
  tiktok: "border-slate-300 bg-slate-50 text-slate-700",
  youtube: "border-red-300 bg-red-50 text-red-700",
  other: "border-border bg-muted/30 text-muted-foreground",
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-background p-4 text-center">
      <div className="mb-1 flex justify-center text-muted-foreground">{icon}</div>
      <p className="text-2xl font-bold">{value.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

export default function SocialPostDetailPage() {
  const { toast } = useToast()
  const params = useParams()
  const handleBack = useSmartBack("/social")
  const { user } = useAuth()

  const rawId = params?.id
  const postId = Number(Array.isArray(rawId) ? rawId[0] : rawId)
  const isValidId = Number.isFinite(postId)

  const { data: post, isLoading, error, mutate } = useSocialPost(isValidId ? postId : null)

  const canEdit = user?.role === "admin" || user?.role === "manager" || user?.role === "officer"

  const [isEditingMetrics, setIsEditingMetrics] = useState(false)
  const [metrics, setMetrics] = useState({ views: 0, likes: 0, comments: 0, shares: 0 })
  const [savingMetrics, setSavingMetrics] = useState(false)

  const openEditMetrics = () => {
    if (!post) return
    setMetrics({
      views: post.views || 0,
      likes: post.likes || 0,
      comments: post.comments || 0,
      shares: post.shares || 0,
    })
    setIsEditingMetrics(true)
  }

  const handleSaveMetrics = async () => {
    setSavingMetrics(true)
    try {
      await socialPostsService.update(postId, {
        views: metrics.views,
        likes: metrics.likes,
        comments: metrics.comments,
        shares: metrics.shares,
      })
      await mutate()
      setIsEditingMetrics(false)
      toast({ title: "Metrics updated" })
    } catch {
      toast({ title: "Error", description: "Could not update metrics.", variant: "destructive" })
    } finally {
      setSavingMetrics(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (error || !post || !isValidId) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Post not found</p>
        <Button onClick={handleBack}>Back to Social</Button>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <PageHeader
        title={post.title}
        description="Social media post details and engagement metrics"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Social Media", href: "/social" },
          { label: post.title },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            {canEdit && (
              <Button variant="outline" onClick={openEditMetrics}>
                <BarChart3 className="mr-2 h-4 w-4" />
                Update Metrics
              </Button>
            )}
            {post.url && (
              <Button asChild>
                <a href={post.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  View Post
                </a>
              </Button>
            )}
          </div>
        }
      />

      {/* Post info */}
      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/20">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={`capitalize ${PLATFORM_COLORS[post.platform] || PLATFORM_COLORS.other}`}
            >
              {post.platform}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 p-6 sm:grid-cols-3">
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Tag className="h-3.5 w-3.5" /> Indicator
            </p>
            <p className="text-sm font-medium">{post.indicator_name || post.indicator}</p>
          </div>
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" /> Organization
            </p>
            <p className="text-sm font-medium">{post.organization_name || post.organization || "—"}</p>
          </div>
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" /> Post Date
            </p>
            <p className="text-sm font-medium">
              {post.post_date
                ? new Date(post.post_date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
                : "—"}
            </p>
          </div>
          {post.description && (
            <div className="col-span-3 space-y-1">
              <p className="text-xs text-muted-foreground">Description</p>
              <p className="text-sm">{post.description}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Metrics */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              Engagement Metrics
            </CardTitle>
            {canEdit && (
              <Button size="sm" variant="outline" onClick={openEditMetrics}>
                <Edit className="mr-1.5 h-3.5 w-3.5" />
                Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard icon={<Eye className="h-5 w-5" />} label="Views" value={post.views || 0} />
            <MetricCard icon={<ThumbsUp className="h-5 w-5" />} label="Likes" value={post.likes || 0} />
            <MetricCard icon={<MessageCircle className="h-5 w-5" />} label="Comments" value={post.comments || 0} />
            <MetricCard icon={<Share2 className="h-5 w-5" />} label="Shares" value={post.shares || 0} />
          </div>
          {(post.interactions ?? 0) > 0 && (
            <p className="mt-4 text-center text-sm text-muted-foreground">
              Total interactions:{" "}
              <span className="font-semibold text-foreground">{post.interactions?.toLocaleString()}</span>
            </p>
          )}
        </CardContent>
      </Card>

      {/* Edit Metrics Dialog */}
      <Dialog open={isEditingMetrics} onOpenChange={setIsEditingMetrics}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Update Metrics</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2 sm:grid-cols-2">
            {(["views", "likes", "comments", "shares"] as const).map((field) => (
              <div key={field} className="space-y-2">
                <Label className="capitalize">{field}</Label>
                <Input
                  type="number"
                  min={0}
                  value={metrics[field]}
                  onChange={(e) => setMetrics((m) => ({ ...m, [field]: Number(e.target.value) }))}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditingMetrics(false)} disabled={savingMetrics}>
              Cancel
            </Button>
            <Button onClick={handleSaveMetrics} disabled={savingMetrics}>
              {savingMetrics ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
