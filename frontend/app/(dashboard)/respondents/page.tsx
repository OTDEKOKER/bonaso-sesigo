"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, UserSquare2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PageHeader } from "@/components/shared/page-header";
import { OrganizationSelect } from "@/components/shared/organization-select";
import { DataTable } from "@/components/shared/data-table";
import { useAllOrganizations, useRespondents } from "@/lib/hooks/use-api";
import { respondentsService } from "@/lib/api";
import type { Respondent } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

const KP_OPTIONS = [
  "FSW",
  "MSM",
  "PWID",
  "Transgender",
  "Prisoner",
  "Migrant",
  "AGYW",
  "Other",
];

const DISABILITY_OPTIONS = [
  "Visual",
  "Hearing",
  "Physical",
  "Intellectual",
  "Psychosocial",
  "Speech",
  "Albinism",
  "Other",
];

const SPECIAL_ATTRIBUTE_OPTIONS = [
  "Pregnant",
  "Breastfeeding",
  "Orphan",
  "Street-connected",
  "Out of School",
  "Adolescent",
  "Youth",
  "Other",
];

const sanitizePrefixPart = (value: string): string =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, "");

const deriveOrganizationPrefix = (organization: { name?: string; code?: string }): string => {
  const codePrefix = sanitizePrefixPart(organization.code || "");
  if (codePrefix) return codePrefix;

  const words = String(organization.name || "")
    .split(/[^A-Za-z0-9]+/)
    .map((word) => word.trim())
    .filter(Boolean);
  const acronym = sanitizePrefixPart(words.map((word) => word[0]).join(""));
  if (words.length > 1 && acronym.length >= 2) return acronym;

  const compact = sanitizePrefixPart(String(organization.name || ""));
  if (!compact) return "ORG";
  return compact.slice(0, 3).padEnd(3, "X");
};

const extractSuffixForPrefix = (uniqueId: string, prefix: string): number | null => {
  const normalizedId = String(uniqueId || "").toUpperCase().trim();
  const normalizedPrefix = sanitizePrefixPart(prefix);
  if (!normalizedId || !normalizedPrefix) return null;
  const pattern = new RegExp(`^${normalizedPrefix}(?:[-_\\s]?)(\\d+)$`);
  const match = normalizedId.match(pattern);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};

export default function RespondentsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { data: respondentsData, isLoading, error, mutate } = useRespondents();
  const { data: organizationsData } = useAllOrganizations();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingUniqueId, setIsGeneratingUniqueId] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [genderFilter, setGenderFilter] = useState("all");
  const uniqueIdGenerationRef = useRef(0);

  const [formData, setFormData] = useState({
    unique_id: "",
    is_anonymous: false,
    id_no: "",
    first_name: "",
    last_name: "",
    gender: "",
    age_range: "",
    date_of_birth: "",
    phone: "",
    email: "",
    address: "",
    plot_no: "",
    ward: "",
    village: "",
    district: "",
    citizenship: "BW",
    kp_status: [] as string[],
    disability_status: [] as string[],
    special_attribute: [] as string[],
    hiv_positive: false,
    date_positive: "",
    notes: "",
    organization: "",
  });

  const respondents = respondentsData?.results || [];
  const organizations = organizationsData?.results || [];

  // Apply filters and search
  const filteredRespondents = respondents.filter((r) => {
    const matchesSearch =
      r.first_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.last_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.unique_id?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesGender = genderFilter === "all" || r.gender === genderFilter;
    return matchesSearch && matchesGender;
  });

  const activeCount = respondents.filter((r) => r.is_active).length;
  const inactiveCount = respondents.filter((r) => !r.is_active).length;

  const toggleSelection = (
    key: "kp_status" | "disability_status" | "special_attribute",
    value: string
  ) => {
    setFormData((prev) => {
      const selected = prev[key];
      const exists = selected.includes(value);
      return {
        ...prev,
        [key]: exists
          ? selected.filter((item) => item !== value)
          : [...selected, value],
      };
    });
  };

  const columns = [
    {
      key: "name",
      label: "Respondent",
      sortable: true,
      render: (respondent: Respondent) => (
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-secondary text-muted-foreground">
              {respondent.first_name?.[0] || ""}{respondent.last_name?.[0] || ""}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium text-foreground">
              {respondent.first_name} {respondent.last_name}
            </p>
            <p className="text-xs text-muted-foreground">ID: {respondent.unique_id}</p>
          </div>
        </div>
      ),
    },
    {
      key: "gender",
      label: "Gender",
      render: (respondent: Respondent) => (
        <Badge variant="secondary" className="capitalize">
          {respondent.gender || "â€”"}
        </Badge>
      ),
    },
    {
      key: "organization",
      label: "Organization",
      render: (respondent: Respondent) => (
        <span className="text-sm text-muted-foreground">
          {respondent.organization_name || "â€”"}
        </span>
      ),
    },
    {
      key: "created_at",
      label: "Created",
      sortable: true,
      render: (respondent: Respondent) => (
        <p className="text-sm text-muted-foreground">
          {new Date(respondent.created_at).toLocaleDateString()}
        </p>
      ),
    },
  ];

  const generateUniqueIdForOrganization = async (organizationId: string) => {
    const org = organizations.find((entry) => String(entry.id) === organizationId);
    if (!org) {
      setFormData((prev) => ({ ...prev, organization: organizationId, unique_id: "" }));
      return;
    }

    const prefix = deriveOrganizationPrefix({
      name: String((org as { name?: string }).name || ""),
      code: String((org as { code?: string }).code || ""),
    });

    const requestId = ++uniqueIdGenerationRef.current;
    setIsGeneratingUniqueId(true);
    setFormData((prev) => ({ ...prev, organization: organizationId, unique_id: "" }));

    let maxSuffix = 0;

    try {
      let page = 1;
      while (page <= 50) {
        const pageData = await respondentsService.list({
          organization: organizationId,
          page: String(page),
          page_size: "200",
        });
        for (const respondent of pageData.results || []) {
          const suffix = extractSuffixForPrefix(respondent.unique_id, prefix);
          if (suffix !== null && suffix > maxSuffix) {
            maxSuffix = suffix;
          }
        }
        if (!pageData.next) break;
        page += 1;
      }
    } catch {
      for (const respondent of respondents) {
        const sameOrg = String(respondent.organization) === organizationId;
        if (!sameOrg) continue;
        const suffix = extractSuffixForPrefix(respondent.unique_id, prefix);
        if (suffix !== null && suffix > maxSuffix) {
          maxSuffix = suffix;
        }
      }
    } finally {
      if (requestId === uniqueIdGenerationRef.current) {
        const generatedId = `${prefix}${String(maxSuffix + 1).padStart(4, "0")}`;
        setFormData((prev) => ({ ...prev, organization: organizationId, unique_id: generatedId }));
        setIsGeneratingUniqueId(false);
      }
    }
  };

  const handleCreate = async () => {
    if (!formData.unique_id) {
      toast({
        title: "Validation Error",
        description: "Unique ID not generated yet. Select organization first.",
        variant: "destructive",
      });
      return;
    }

    if (!formData.is_anonymous && (!formData.first_name || !formData.last_name)) {
      toast({
        title: "Validation Error",
        description: "Please fill in first name and last name",
        variant: "destructive",
      });
      return;
    }

    if (!formData.gender) {
      toast({
        title: "Validation Error",
        description: "Please select gender",
        variant: "destructive",
      });
      return;
    }

    if (formData.hiv_positive && !formData.date_positive) {
      toast({
        title: "Validation Error",
        description: "Please provide date positive when HIV positive is selected",
        variant: "destructive",
      });
      return;
    }

    if (!formData.organization) {
      toast({
        title: "Validation Error",
        description: "Please select an organization",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const demographics: Record<string, unknown> = {
        is_anonymous: formData.is_anonymous,
        id_no: formData.id_no || null,
        age_range: formData.age_range || null,
        plot_no: formData.plot_no || null,
        ward: formData.ward || null,
        village: formData.village || null,
        district: formData.district || null,
        citizenship: formData.citizenship || null,
        kp_status: formData.kp_status,
        disability_status: formData.disability_status,
        special_attribute: formData.special_attribute,
        hiv_status: {
          hiv_positive: formData.hiv_positive,
          date_positive: formData.hiv_positive ? formData.date_positive || null : null,
        },
        notes: formData.notes || null,
      };
      const computedAddress = [formData.plot_no, formData.ward, formData.village, formData.district]
        .map((entry) => entry.trim())
        .filter(Boolean)
        .join(", ");

      await respondentsService.create({
        unique_id: formData.unique_id,
        first_name: formData.is_anonymous ? "Anonymous" : formData.first_name,
        last_name: formData.is_anonymous ? formData.unique_id : formData.last_name,
        gender: formData.gender as Respondent["gender"],
        date_of_birth: formData.is_anonymous ? undefined : formData.date_of_birth || undefined,
        phone: formData.phone || undefined,
        email: formData.email || undefined,
        address: formData.address || computedAddress || undefined,
        demographics,
        organization: Number(formData.organization),
      });
      toast({
        title: "Success",
        description: "Respondent registered successfully",
      });
      setIsCreateOpen(false);
      setFormData({
        unique_id: "",
        is_anonymous: false,
        id_no: "",
        first_name: "",
        last_name: "",
        gender: "",
        age_range: "",
        date_of_birth: "",
        phone: "",
        email: "",
        address: "",
        plot_no: "",
        ward: "",
        village: "",
        district: "",
        citizenship: "BW",
        kp_status: [],
        disability_status: [],
        special_attribute: [],
        hiv_positive: false,
        date_positive: "",
        notes: "",
        organization: "",
      });
      mutate(); // refresh data
    } catch {
      toast({
        title: "Error",
        description: "Failed to register respondent",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const actions = (respondent: Respondent) => [
    { label: "View Profile", onClick: () => router.push(`/respondents/${respondent.id}`) },
    { label: "Edit Respondent", onClick: () => router.push(`/respondents/${respondent.id}/edit`) },
    {
      label: "New Interaction",
      onClick: () => router.push(`/respondents/interactions?respondentId=${respondent.id}`),
    },
    { label: "View History", onClick: () => router.push(`/respondents/${respondent.id}/history`) },
    { label: "Flag Record", onClick: () => router.push(`/flags?respondentId=${respondent.id}`) },
  ];

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Failed to load respondents</p>
        <Button onClick={() => mutate()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Respondents"
        description="Manage respondent profiles and track interactions"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Respondents" },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href="/respondents/interactions">View Interactions</Link>
            </Button>
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Respondent
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          placeholder="Search by name or ID..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full"
        />
        <Select value={genderFilter} onValueChange={setGenderFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Gender" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="male">Male</SelectItem>
            <SelectItem value="female">Female</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-primary/10 p-2">
              <UserSquare2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total</p>
              <p className="text-2xl font-bold text-foreground">{respondents.length}</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Active</p>
          <p className="text-2xl font-bold text-foreground">{activeCount}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Inactive</p>
          <p className="text-2xl font-bold text-muted-foreground">{inactiveCount}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Organizations</p>
          <p className="text-2xl font-bold text-chart-5">{organizations.length}</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="all">
        <TabsList className="bg-secondary">
          <TabsTrigger value="all">All Respondents</TabsTrigger>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="inactive">Inactive</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-6">
          <DataTable
            data={filteredRespondents}
            columns={columns}
            searchPlaceholder="Search by name or ID..."
            onRowClick={(r) => router.push(`/respondents/${r.id}`)}
            actions={actions}
          />
        </TabsContent>

        <TabsContent value="active" className="mt-6">
          <DataTable
            data={filteredRespondents.filter((r) => r.is_active)}
            columns={columns}
            onRowClick={(r) => router.push(`/respondents/${r.id}`)}
            actions={actions}
          />
        </TabsContent>

        <TabsContent value="inactive" className="mt-6">
          <DataTable
            data={filteredRespondents.filter((r) => !r.is_active)}
            columns={columns}
            onRowClick={(r) => router.push(`/respondents/${r.id}`)}
            actions={actions}
          />
        </TabsContent>
      </Tabs>

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Register Respondent</DialogTitle>
            <DialogDescription>Add a new respondent to the system</DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              handleCreate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="uniqueId">Unique ID *</Label>
                <Input
                  id="uniqueId"
                  placeholder="Auto-generated"
                  value={formData.unique_id}
                  readOnly
                  disabled
                />
                <p className="text-xs text-muted-foreground">
                  Auto-generated from selected organization.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="organization">Organization *</Label>
                <OrganizationSelect
                  organizations={organizations}
                  value={formData.organization}
                  onChange={(value) => {
                    void generateUniqueIdForOrganization(value);
                  }}
                  placeholder="Select organization"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-md border p-3">
              <Checkbox
                checked={formData.is_anonymous}
                onCheckedChange={(checked) =>
                  setFormData((prev) => ({ ...prev, is_anonymous: checked === true }))
                }
              />
              <Label>Respondent wishes to remain anonymous</Label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="idNo">ID/Passport Number</Label>
                <Input
                  id="idNo"
                  placeholder="Optional ID number"
                  value={formData.id_no}
                  onChange={(e) => setFormData({ ...formData, id_no: e.target.value })}
                />
              </div>
              {formData.is_anonymous ? (
                <div className="space-y-2">
                  <Label htmlFor="ageRange">Age Range</Label>
                  <Input
                    id="ageRange"
                    placeholder="e.g., 20-24"
                    value={formData.age_range}
                    onChange={(e) => setFormData({ ...formData, age_range: e.target.value })}
                  />
                </div>
              ) : null}
            </div>

            {!formData.is_anonymous ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  placeholder="Enter first name"
                  value={formData.first_name}
                  onChange={(e) =>
                    setFormData({ ...formData, first_name: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name *</Label>
                <Input
                  id="lastName"
                  placeholder="Enter last name"
                  value={formData.last_name}
                  onChange={(e) =>
                    setFormData({ ...formData, last_name: e.target.value })
                  }
                />
              </div>
            </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="gender">Gender *</Label>
                <Select
                  value={formData.gender}
                  onValueChange={(value) =>
                    setFormData({ ...formData, gender: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select gender" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dob">Date of Birth</Label>
                <Input
                  id="dob"
                  type="date"
                  value={formData.date_of_birth}
                  onChange={(e) =>
                    setFormData({ ...formData, date_of_birth: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="plotNo">Plot Number</Label>
                <Input
                  id="plotNo"
                  value={formData.plot_no}
                  onChange={(e) => setFormData({ ...formData, plot_no: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ward">Ward</Label>
                <Input
                  id="ward"
                  value={formData.ward}
                  onChange={(e) => setFormData({ ...formData, ward: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="village">Village/Town/City</Label>
                <Input
                  id="village"
                  value={formData.village}
                  onChange={(e) => setFormData({ ...formData, village: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="district">District</Label>
                <Input
                  id="district"
                  value={formData.district}
                  onChange={(e) => setFormData({ ...formData, district: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="citizenship">Citizenship</Label>
                <Input
                  id="citizenship"
                  value={formData.citizenship}
                  onChange={(e) => setFormData({ ...formData, citizenship: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Key Population Status</Label>
              <div className="grid grid-cols-2 gap-2 rounded-md border p-3">
                {KP_OPTIONS.map((option) => (
                  <label key={option} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={formData.kp_status.includes(option)}
                      onCheckedChange={() => toggleSelection("kp_status", option)}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Disability Status</Label>
              <div className="grid grid-cols-2 gap-2 rounded-md border p-3">
                {DISABILITY_OPTIONS.map((option) => (
                  <label key={option} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={formData.disability_status.includes(option)}
                      onCheckedChange={() => toggleSelection("disability_status", option)}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Special Attributes</Label>
              <div className="grid grid-cols-2 gap-2 rounded-md border p-3">
                {SPECIAL_ATTRIBUTE_OPTIONS.map((option) => (
                  <label key={option} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={formData.special_attribute.includes(option)}
                      onCheckedChange={() => toggleSelection("special_attribute", option)}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-md border p-3">
              <Checkbox
                checked={formData.hiv_positive}
                onCheckedChange={(checked) =>
                  setFormData((prev) => ({ ...prev, hiv_positive: checked === true }))
                }
              />
              <Label>HIV Positive</Label>
            </div>

            {formData.hiv_positive ? (
              <div className="space-y-2">
                <Label htmlFor="datePositive">Date tested HIV Positive *</Label>
                <Input
                  id="datePositive"
                  type="date"
                  value={formData.date_positive}
                  onChange={(e) => setFormData({ ...formData, date_positive: e.target.value })}
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                rows={2}
                placeholder="Any additional respondent detail"
                value={formData.notes}
                onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || isGeneratingUniqueId}>
                Register Respondent
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
