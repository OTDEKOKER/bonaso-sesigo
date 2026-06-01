"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { OrganizationSelect } from "@/components/shared/organization-select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  User,
  Bell,
  Shield,
  Database,
  Palette,
  Mail,
  Save,
  Upload,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/lib/contexts/auth-context";
import { notificationsService } from "@/lib/api";
import { useAllOrganizations, useNotifications } from "@/lib/hooks/use-api";
import { useToast } from "@/hooks/use-toast";
import { getUserRoleLabel } from "@/lib/roles";

type UserProfileSource = {
  firstName?: string;
  first_name?: string;
  lastName?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  role?: string;
  organizationId?: string | number;
  organization?: string | number;
};

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: orgsData } = useAllOrganizations();
  const { data: notificationsData, isLoading: notificationsLoading, mutate: mutateNotifications } = useNotifications();
  const organizations = orgsData?.results || [];
  const notifications = notificationsData?.results || [];
  const defaultTab = searchParams.get("tab") || "profile";
  const userProfile = useMemo(() => {
    const source = (user ?? {}) as UserProfileSource;
    return {
      firstName: source.firstName || source.first_name || "",
      lastName: source.lastName || source.last_name || "",
      email: source.email || "",
      phone: source.phone || "",
      role: source.role || "",
      organizationId: String(source.organizationId ?? source.organization ?? ""),
    };
  }, [user]);

  const [profileOverrides, setProfileOverrides] = useState<Partial<typeof userProfile>>({});
  const profile = {
    ...userProfile,
    ...profileOverrides,
  };

  const [preferences, setPreferences] = useState({
    language: "en",
    timezone: "Africa/Gaborone",
    dateFormat: "DD/MM/YYYY",
    defaultProject: "all",
  });

  const setProfileField = <K extends keyof typeof userProfile>(key: K, value: (typeof userProfile)[K]) => {
    setProfileOverrides((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleMarkAllNotificationsRead = async () => {
    try {
      await notificationsService.markAllRead();
      await mutateNotifications();
      toast({
        title: "Notifications updated",
        description: "All notifications have been marked as read.",
      });
    } catch {
      toast({
        title: "Unable to update notifications",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage your account settings and preferences"
      />

      <Tabs defaultValue={defaultTab} className="space-y-6">
        <TabsList className="bg-secondary border border-border">
          <TabsTrigger value="profile" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <User className="h-4 w-4 mr-2" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="notifications" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Bell className="h-4 w-4 mr-2" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="security" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Shield className="h-4 w-4 mr-2" />
            Security
          </TabsTrigger>
          <TabsTrigger value="preferences" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Palette className="h-4 w-4 mr-2" />
            Preferences
          </TabsTrigger>
          <TabsTrigger value="data" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Database className="h-4 w-4 mr-2" />
            Data
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-foreground">Profile Information</CardTitle>
              <CardDescription>
                Update your personal information and contact details
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-6">
                <Avatar className="h-20 w-20">
                  <AvatarImage src="/placeholder-avatar.jpg" />
                  <AvatarFallback className="bg-primary text-primary-foreground text-xl">
                    {(profile.firstName?.[0] || "U").toUpperCase()}
                    {(profile.lastName?.[0] || "").toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <Button variant="outline" className="border-border bg-transparent">
                    <Upload className="h-4 w-4 mr-2" />
                    Upload Photo
                  </Button>
                  <p className="text-xs text-muted-foreground mt-2">
                    JPG, PNG or GIF. Max 2MB.
                  </p>
                </div>
              </div>

              <Separator className="bg-border" />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="firstName" className="text-foreground">First Name</Label>
                  <Input
                    id="firstName"
                    value={profile.firstName}
                    onChange={(e) => setProfileField("firstName", e.target.value)}
                    className="bg-input border-border text-foreground"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName" className="text-foreground">Last Name</Label>
                  <Input
                    id="lastName"
                    value={profile.lastName}
                    onChange={(e) => setProfileField("lastName", e.target.value)}
                    className="bg-input border-border text-foreground"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-foreground">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    value={profile.email}
                    onChange={(e) => setProfileField("email", e.target.value)}
                    className="bg-input border-border text-foreground"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone" className="text-foreground">Phone Number</Label>
                  <Input
                    id="phone"
                    value={profile.phone}
                    onChange={(e) => setProfileField("phone", e.target.value)}
                    className="bg-input border-border text-foreground"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-foreground">Role</Label>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-primary/20 text-primary border-primary/30">
                      {getUserRoleLabel(profile.role)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      Contact admin to change
                    </span>
                  </div>
                </div>
                <div className="space-y-2">
                                  <Label className="text-foreground">Organization</Label>
                <OrganizationSelect
                  organizations={organizations}
                  value={profile.organizationId}
                  onChange={(value) => setProfileField("organizationId", value)}
                  includeAll
                  allLabel="All organizations"
                  placeholder="Select organization"
                /></div>
                <div className="space-y-2">
                  <Label htmlFor="timezone" className="text-foreground">Timezone</Label>
                  <Select
                    value={preferences.timezone}
                    onValueChange={(value) => setPreferences({ ...preferences, timezone: value })}
                  >
                    <SelectTrigger className="bg-input border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Africa/Gaborone">Africa/Gaborone (CAT)</SelectItem>
                      <SelectItem value="Africa/Johannesburg">Africa/Johannesburg (SAST)</SelectItem>
                      <SelectItem value="UTC">UTC</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dateFormat" className="text-foreground">Date Format</Label>
                  <Select
                    value={preferences.dateFormat}
                    onValueChange={(value) => setPreferences({ ...preferences, dateFormat: value })}
                  >
                    <SelectTrigger className="bg-input border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                      <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                      <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="defaultProject" className="text-foreground">Default Project</Label>
                  <Select
                    value={preferences.defaultProject}
                    onValueChange={(value) => setPreferences({ ...preferences, defaultProject: value })}
                  >
                    <SelectTrigger className="bg-input border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Projects</SelectItem>
                      <SelectItem value="usaid">USAID Health Initiative</SelectItem>
                      <SelectItem value="global-fund">Global Fund Round 12</SelectItem>
                      <SelectItem value="pepfar">PEPFAR OVC</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex justify-end">
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                  <Save className="h-4 w-4 mr-2" />
                  Save Preferences
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-6">
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="text-foreground">Notifications</CardTitle>
                <CardDescription>
                  Review aggregate approvals, flagged corrections, and coordinator follow-up requests.
                </CardDescription>
              </div>
              <Button variant="outline" onClick={() => void handleMarkAllNotificationsRead()}>
                <Mail className="h-4 w-4 mr-2" />
                Mark all read
              </Button>
            </CardHeader>
            <CardContent>
              {notificationsLoading ? (
                <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading notifications...
                </div>
              ) : notifications.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                  No notifications yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {notifications.map((notification) => (
                    <button
                      key={notification.id}
                      type="button"
                      className="w-full rounded-xl border border-border bg-background px-4 py-3 text-left transition hover:border-primary/40 hover:bg-muted/30"
                      onClick={async () => {
                        if (!notification.is_read) {
                          await notificationsService.markRead(Number(notification.id));
                          await mutateNotifications();
                        }
                        router.push(notification.link || "/settings?tab=notifications");
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-foreground">{notification.title}</p>
                            {!notification.is_read ? (
                              <Badge variant="outline" className="border-primary/30 text-primary">
                                New
                              </Badge>
                            ) : null}
                          </div>
                          <p className="text-sm text-muted-foreground">{notification.content}</p>
                        </div>
                        <p className="shrink-0 text-xs text-muted-foreground">
                          {new Date(notification.created_at).toLocaleString()}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="data" className="space-y-6">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-foreground">Data Export</CardTitle>
              <CardDescription>
                Export your data for backup or analysis
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Button variant="outline" className="border-border justify-start bg-transparent">
                  <Database className="h-4 w-4 mr-2" />
                  Export All Respondents (CSV)
                </Button>
                <Button variant="outline" className="border-border justify-start bg-transparent">
                  <Database className="h-4 w-4 mr-2" />
                  Export All Responses (CSV)
                </Button>
                <Button variant="outline" className="border-border justify-start bg-transparent">
                  <Database className="h-4 w-4 mr-2" />
                  Export All Indicators (CSV)
                </Button>
                <Button variant="outline" className="border-border justify-start bg-transparent">
                  <Database className="h-4 w-4 mr-2" />
                  Export All Events (CSV)
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-foreground">Data Import</CardTitle>
              <CardDescription>
                Import data from external sources
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
                <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-foreground font-medium mb-2">
                  Drag and drop files here, or click to browse
                </p>
                <p className="text-sm text-muted-foreground mb-4">
                  Supports CSV, XLSX formats. Max file size: 50MB
                </p>
                <Button variant="outline" className="border-border bg-transparent">
                  Select Files
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border border-destructive/50">
            <CardHeader>
              <CardTitle className="text-destructive">Danger Zone</CardTitle>
              <CardDescription>
                Irreversible actions that affect your data
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-destructive/10 rounded-lg">
                <div>
                  <p className="text-foreground font-medium">Request Account Data</p>
                  <p className="text-sm text-muted-foreground">
                    Download all data associated with your account
                  </p>
                </div>
                <Button variant="outline" className="border-border bg-transparent">
                  <Mail className="h-4 w-4 mr-2" />
                  Request
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
