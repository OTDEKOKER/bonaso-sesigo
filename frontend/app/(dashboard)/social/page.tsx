"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Filter, CheckCircle2, Loader2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/page-header";
import { socialPostsService } from "@/lib/api";
import { OrganizationSelect } from "@/components/shared/organization-select";
import { useIndicators, useAllOrganizations, useSocialPosts } from "@/lib/hooks/use-api";
import type { SocialPost } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};

export default function SocialPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [postSearch, setPostSearch] = useState("");
  const [postPlatformFilter, setPostPlatformFilter] = useState("all");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPostDialogOpen, setIsPostDialogOpen] = useState(false);
  const [isMetricsDialogOpen, setIsMetricsDialogOpen] = useState(false);
  const [activePost, setActivePost] = useState<SocialPost | null>(null);
  const [editingPost, setEditingPost] = useState<SocialPost | null>(null);

  const [postForm, setPostForm] = useState({
    title: "",
    description: "",
    post_date: "",
    indicator: "",
    organization: "",
    platform: "facebook",
    url: "",
    views: "",
    likes: "",
    comments: "",
    shares: "",
  });

  const [metricsForm, setMetricsForm] = useState({
    views: "",
    likes: "",
    comments: "",
    shares: "",
  });

  const { data: organizationsData } = useAllOrganizations();
  const { data: indicatorsData } = useIndicators();
  // Filter server-side so search/platform apply across ALL posts, not just the
  // first loaded page (the list is paginated).
  const [debouncedPostSearch, setDebouncedPostSearch] = useState("");
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedPostSearch(postSearch.trim()), 300);
    return () => clearTimeout(handle);
  }, [postSearch]);
  const postFilters = useMemo(() => {
    const f: Record<string, string> = { page_size: "500" };
    if (debouncedPostSearch) f.search = debouncedPostSearch;
    if (postPlatformFilter !== "all") f.platform = postPlatformFilter;
    return f;
  }, [debouncedPostSearch, postPlatformFilter]);
  const {
    data: postsData,
    isLoading: postsLoading,
    error: postsError,
    mutate: mutatePosts,
  } = useSocialPosts(postFilters);

  const organizations = organizationsData?.results || [];
  const indicators = indicatorsData?.results || [];
  const posts = useMemo(() => postsData?.results ?? [], [postsData?.results]);

  // Search + platform applied server-side (see postFilters); render as-is.
  const filteredPosts = posts;

  const postStats = useMemo(() => {
    const totalViews = posts.reduce((sum, post) => sum + (post.views || 0), 0);
    const totalInteractions = posts.reduce(
      (sum, post) => sum + (post.interactions || 0),
      0
    );
    return {
      total: posts.length,
      views: totalViews,
      interactions: totalInteractions,
    };
  }, [posts]);

  const resetPostForm = () => {
    setPostForm({
      title: "",
      description: "",
      post_date: "",
      indicator: "",
      organization: "",
      platform: "facebook",
      url: "",
      views: "",
      likes: "",
      comments: "",
      shares: "",
    });
  };

  const handleCreatePost = async () => {
    if (!postForm.title || !postForm.indicator || !postForm.organization || !postForm.post_date || !postForm.url) {
      toast({
        title: "Missing required fields",
        description: "Title, organization, post date, indicator, and link are required.",
        variant: "destructive",
      });
      return;
    }
    setIsSubmitting(true);
    try {
      await socialPostsService.create({
        title: postForm.title,
        description: postForm.description || undefined,
        post_date: postForm.post_date || undefined,
        indicator: Number(postForm.indicator),
        organization: postForm.organization ? Number(postForm.organization) : undefined,
        platform: postForm.platform as SocialPost["platform"],
        url: postForm.url,
        views: postForm.views ? Number(postForm.views) : undefined,
        likes: postForm.likes ? Number(postForm.likes) : undefined,
        comments: postForm.comments ? Number(postForm.comments) : undefined,
        shares: postForm.shares ? Number(postForm.shares) : undefined,
      });
      toast({
        title: "Post created",
        description: "Social media post logged successfully.",
      });
      resetPostForm();
      setIsPostDialogOpen(false);
      mutatePosts();
    } catch (err) {
      console.error("Failed to create post", err);
      toast({
        title: "Error",
        description: getErrorMessage(err, "Failed to create social post."),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdatePost = async () => {
    if (!editingPost) return;
    if (!postForm.title || !postForm.indicator || !postForm.organization || !postForm.post_date || !postForm.url) {
      toast({
        title: "Missing required fields",
        description: "Title, organization, post date, indicator, and link are required.",
        variant: "destructive",
      });
      return;
    }
    setIsSubmitting(true);
    try {
      await socialPostsService.update(Number(editingPost.id), {
        title: postForm.title,
        description: postForm.description || undefined,
        post_date: postForm.post_date || undefined,
        indicator: Number(postForm.indicator),
        organization: postForm.organization ? Number(postForm.organization) : undefined,
        platform: postForm.platform as SocialPost["platform"],
        url: postForm.url,
        views: postForm.views ? Number(postForm.views) : undefined,
        likes: postForm.likes ? Number(postForm.likes) : undefined,
        comments: postForm.comments ? Number(postForm.comments) : undefined,
        shares: postForm.shares ? Number(postForm.shares) : undefined,
      });
      toast({
        title: "Post updated",
        description: "Social media post updated successfully.",
      });
      resetPostForm();
      setEditingPost(null);
      setIsPostDialogOpen(false);
      mutatePosts();
    } catch (err) {
      console.error("Failed to update post", err);
      toast({
        title: "Error",
        description: getErrorMessage(err, "Failed to update social post."),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreatePostAndContinue = async () => {
    if (!postForm.title || !postForm.indicator || !postForm.organization || !postForm.post_date || !postForm.url) {
      toast({
        title: "Missing required fields",
        description: "Title, organization, post date, indicator, and link are required.",
        variant: "destructive",
      });
      return;
    }
    setIsSubmitting(true);
    try {
      await socialPostsService.create({
        title: postForm.title,
        description: postForm.description || undefined,
        post_date: postForm.post_date || undefined,
        indicator: Number(postForm.indicator),
        organization: postForm.organization ? Number(postForm.organization) : undefined,
        platform: postForm.platform as SocialPost["platform"],
        url: postForm.url,
        views: postForm.views ? Number(postForm.views) : undefined,
        likes: postForm.likes ? Number(postForm.likes) : undefined,
        comments: postForm.comments ? Number(postForm.comments) : undefined,
        shares: postForm.shares ? Number(postForm.shares) : undefined,
      });
      toast({
        title: "Post created",
        description: "You can add another post now.",
      });
      resetPostForm();
      mutatePosts();
    } catch (err) {
      console.error("Failed to create post", err);
      toast({
        title: "Error",
        description: getErrorMessage(err, "Failed to create social post."),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const openMetricsDialog = (post: SocialPost) => {
    setActivePost(post);
    setMetricsForm({
      views: post.views ? String(post.views) : "",
      likes: post.likes ? String(post.likes) : "",
      comments: post.comments ? String(post.comments) : "",
      shares: post.shares ? String(post.shares) : "",
    });
    setIsMetricsDialogOpen(true);
  };

  const handleUpdateMetrics = async () => {
    if (!activePost) return;
    setIsSubmitting(true);
    try {
      await socialPostsService.update(Number(activePost.id), {
        views: metricsForm.views ? Number(metricsForm.views) : undefined,
        likes: metricsForm.likes ? Number(metricsForm.likes) : undefined,
        comments: metricsForm.comments ? Number(metricsForm.comments) : undefined,
        shares: metricsForm.shares ? Number(metricsForm.shares) : undefined,
      });
      toast({
        title: "Metrics updated",
        description: "Post performance metrics updated.",
      });
      setIsMetricsDialogOpen(false);
      setActivePost(null);
      mutatePosts();
    } catch (err) {
      console.error("Failed to update metrics", err);
      toast({
        title: "Error",
        description: "Failed to update metrics.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (postsLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (postsError) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Failed to load social media data</p>
        <Button onClick={() => mutatePosts()}>Retry</Button>
      </div>
    );
  }

  return (
    <Dialog open={isPostDialogOpen} onOpenChange={setIsPostDialogOpen}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Social Media"
          description="Register posts, link indicators, and track performance"
          breadcrumbs={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Social Media" },
          ]}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Post
            </Button>
          </DialogTrigger>
        </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Posts</CardDescription>
            <CardTitle className="text-2xl">{postStats.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Views</CardDescription>
            <CardTitle className="text-2xl">{postStats.views}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Interactions</CardDescription>
            <CardTitle className="text-2xl">{postStats.interactions}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search posts..."
              value={postSearch}
              onChange={(e) => setPostSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={postPlatformFilter} onValueChange={setPostPlatformFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Platform" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Platforms</SelectItem>
              <SelectItem value="facebook">Facebook</SelectItem>
              <SelectItem value="instagram">Instagram</SelectItem>
              <SelectItem value="twitter">Twitter/X</SelectItem>
              <SelectItem value="tiktok">TikTok</SelectItem>
              <SelectItem value="youtube">YouTube</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DialogTrigger asChild>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add Post
          </Button>
        </DialogTrigger>
      </div>

      <div className="space-y-4">
        {filteredPosts.map((post) => (
          <Card key={post.id}>
            <CardContent className="p-4 space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-medium">{post.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {post.indicator_name || "Indicator"} - {post.platform}
                  </p>
                  {post.organization_name && (
                    <p className="text-xs text-muted-foreground">{post.organization_name}</p>
                  )}
                  {post.post_date && (
                    <p className="text-xs text-muted-foreground">
                      Posted on: {new Date(post.post_date).toLocaleDateString()}
                    </p>
                  )}
                  {post.description && (
                    <p className="text-xs text-muted-foreground">{post.description}</p>
                  )}
                  <a
                    href={post.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary underline"
                  >
                    View post
                  </a>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.push(`/social/${post.id}`)}
                  >
                    <Eye className="mr-1.5 h-3.5 w-3.5" />
                    View
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingPost(post);
                      setPostForm({
                        title: post.title || "",
                        description: post.description || "",
                        post_date: post.post_date || "",
                        indicator: post.indicator ? String(post.indicator) : "",
                        organization: post.organization ? String(post.organization) : "",
                        platform: post.platform || "facebook",
                        url: post.url || "",
                        views: post.views ? String(post.views) : "",
                        likes: post.likes ? String(post.likes) : "",
                        comments: post.comments ? String(post.comments) : "",
                        shares: post.shares ? String(post.shares) : "",
                      });
                      setIsPostDialogOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openMetricsDialog(post)}>
                    Update Metrics
                  </Button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-5 text-xs text-muted-foreground">
                <span>Views: {post.views ?? 0}</span>
                <span>Likes: {post.likes ?? 0}</span>
                <span>Comments: {post.comments ?? 0}</span>
                <span>Shares: {post.shares ?? 0}</span>
                <span>Interactions: {post.interactions ?? 0}</span>
              </div>
            </CardContent>
          </Card>
        ))}

        {filteredPosts.length === 0 && (
          <Card className="p-10 text-center">
            <CheckCircle2 className="h-10 w-10 text-muted-foreground/50 mb-3 mx-auto" />
            <h3 className="text-lg font-semibold">No posts found</h3>
            <p className="text-muted-foreground mt-1">
              Add a post to start tracking performance.
            </p>
          </Card>
        )}
      </div>

      <Dialog open={isMetricsDialogOpen} onOpenChange={setIsMetricsDialogOpen}>
        <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Update Metrics</DialogTitle>
            <DialogDescription>
              Paste the latest metrics from the social post.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-2">
              <Label>Views</Label>
              <Input
                type="number"
                value={metricsForm.views}
                onChange={(e) => setMetricsForm({ ...metricsForm, views: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Likes</Label>
              <Input
                type="number"
                value={metricsForm.likes}
                onChange={(e) => setMetricsForm({ ...metricsForm, likes: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Comments</Label>
              <Input
                type="number"
                value={metricsForm.comments}
                onChange={(e) => setMetricsForm({ ...metricsForm, comments: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Shares</Label>
              <Input
                type="number"
                value={metricsForm.shares}
                onChange={(e) => setMetricsForm({ ...metricsForm, shares: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsMetricsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateMetrics} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Metrics
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Log Social Media Post</DialogTitle>
          <DialogDescription>
            Add a post, link it to an indicator, and track performance.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="post-title">Post Name (Required)</Label>
            <Input
              id="post-title"
              placeholder="ex: NCD Facebook Campaign post 5..."
              value={postForm.title}
              onChange={(e) => setPostForm({ ...postForm, title: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="post-description">Post Description</Label>
            <Input
              id="post-description"
              placeholder="Any information that you may want to remember about this post..."
              value={postForm.description}
              onChange={(e) => setPostForm({ ...postForm, description: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="post-date">Post Made On (Required)</Label>
            <Input
              id="post-date"
              type="date"
              value={postForm.post_date}
              onChange={(e) => setPostForm({ ...postForm, post_date: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="post-link">Link to Post</Label>
            <Input
              id="post-link"
              placeholder="https://"
              value={postForm.url}
              onChange={(e) => setPostForm({ ...postForm, url: e.target.value })}
            />
          </div>
          <div className="space-y-2">
                        <Label htmlFor="post-org">Organization (Required)</Label>
            <OrganizationSelect
              organizations={organizations}
              value={postForm.organization}
              onChange={(value) => setPostForm({ ...postForm, organization: value })}
              placeholder="For Organization"
            /></div>
          <div className="space-y-2">
            <Label htmlFor="post-indicator">Indicator</Label>
            <Select
              value={postForm.indicator}
              onValueChange={(value) => setPostForm({ ...postForm, indicator: value })}
            >
              <SelectTrigger id="post-indicator">
                <SelectValue placeholder="Select indicator" />
              </SelectTrigger>
              <SelectContent>
                {indicators.map((indicator) => (
                  <SelectItem key={indicator.id} value={String(indicator.id)}>
                    {indicator.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="post-platform">Post Made on Platform (Required)</Label>
            <Select
              value={postForm.platform}
              onValueChange={(value) => setPostForm({ ...postForm, platform: value })}
            >
              <SelectTrigger id="post-platform">
                <SelectValue placeholder="Select platform" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="facebook">Facebook</SelectItem>
                <SelectItem value="instagram">Instagram</SelectItem>
                <SelectItem value="twitter">Twitter/X</SelectItem>
                <SelectItem value="tiktok">TikTok</SelectItem>
                <SelectItem value="youtube">YouTube</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Views</Label>
              <Input
                type="number"
                value={postForm.views}
                onChange={(e) => setPostForm({ ...postForm, views: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Likes</Label>
              <Input
                type="number"
                value={postForm.likes}
                onChange={(e) => setPostForm({ ...postForm, likes: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Comments</Label>
              <Input
                type="number"
                value={postForm.comments}
                onChange={(e) => setPostForm({ ...postForm, comments: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Shares</Label>
              <Input
                type="number"
                value={postForm.shares}
                onChange={(e) => setPostForm({ ...postForm, shares: e.target.value })}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setIsPostDialogOpen(false);
              setEditingPost(null);
              resetPostForm();
            }}
          >
            Cancel
          </Button>
          <Button onClick={editingPost ? handleUpdatePost : handleCreatePost} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editingPost ? "Update" : "Save"}
          </Button>
          {!editingPost && (
            <Button onClick={handleCreatePostAndContinue} disabled={isSubmitting} variant="secondary">
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save and Create Another
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
      </div>
    </Dialog>
  );
}
