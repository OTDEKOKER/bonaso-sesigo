"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { OrganizationSelect } from "@/components/shared/organization-select";
import { useAllOrganizations, useRespondent } from "@/lib/hooks/use-api";
import { respondentsService } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

const asString = (value: unknown): string => (value === null || value === undefined ? "" : String(value));

const asArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
};

export default function EditRespondentPage() {
  const router = useRouter();
  const { toast } = useToast();
  const params = useParams();
  const id = Number(params?.id);
  const handleBack = useSmartBack(Number.isFinite(id) ? `/respondents/${id}` : "/respondents");

  const { data: respondent, isLoading, error } = useRespondent(Number.isFinite(id) ? id : null);
  const { data: organizationsData } = useAllOrganizations();
  const organizations = organizationsData?.results || [];

  const [isSubmitting, setIsSubmitting] = useState(false);
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

  useEffect(() => {
    if (!respondent) return;
    const demographics = (respondent.demographics || {}) as Record<string, unknown>;
    const hivStatus =
      demographics.hiv_status && typeof demographics.hiv_status === "object"
        ? (demographics.hiv_status as Record<string, unknown>)
        : {};

    setFormData({
      unique_id: respondent.unique_id || "",
      is_anonymous: Boolean(demographics.is_anonymous),
      id_no: asString(demographics.id_no),
      first_name: respondent.first_name || "",
      last_name: respondent.last_name || "",
      gender: respondent.gender || "",
      age_range: asString(demographics.age_range),
      date_of_birth: respondent.date_of_birth ? String(respondent.date_of_birth).slice(0, 10) : "",
      phone: respondent.phone || "",
      email: respondent.email || "",
      address: respondent.address || "",
      plot_no: asString(demographics.plot_no),
      ward: asString(demographics.ward),
      village: asString(demographics.village),
      district: asString(demographics.district),
      citizenship: asString(demographics.citizenship) || "BW",
      kp_status: asArray(demographics.kp_status),
      disability_status: asArray(demographics.disability_status),
      special_attribute: asArray(demographics.special_attribute),
      hiv_positive:
        hivStatus.hiv_positive === true ||
        asString(hivStatus.hiv_positive).toLowerCase() === "true" ||
        asString(demographics.hiv_positive).toLowerCase() === "true",
      date_positive: asString(hivStatus.date_positive).slice(0, 10),
      notes: asString(demographics.notes),
      organization: respondent.organization ? String(respondent.organization) : "",
    });
  }, [respondent]);

  const handleSave = async () => {
    if (!formData.unique_id) {
      toast({
        title: "Validation Error",
        description: "Please fill in unique ID",
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
    if (!formData.organization) {
      toast({
        title: "Validation Error",
        description: "Please select an organization",
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
    if (formData.hiv_positive && !formData.date_positive) {
      toast({
        title: "Validation Error",
        description: "Please provide date positive when HIV positive is selected",
        variant: "destructive",
      });
      return;
    }
    if (!respondent) return;

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

      await respondentsService.update(Number(respondent.id), {
        unique_id: formData.unique_id,
        first_name: formData.is_anonymous ? "Anonymous" : formData.first_name,
        last_name: formData.is_anonymous ? formData.unique_id : formData.last_name,
        gender: formData.gender as "male" | "female" | "other",
        date_of_birth: formData.is_anonymous ? undefined : formData.date_of_birth || undefined,
        phone: formData.phone || undefined,
        email: formData.email || undefined,
        address: formData.address || computedAddress || undefined,
        demographics,
        organization: Number(formData.organization),
      });

      toast({
        title: "Saved",
        description: "Respondent updated successfully",
      });
      router.push(`/respondents/${respondent.id}`);
    } catch {
      toast({
        title: "Error",
        description: "Failed to update respondent",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleSelection = (
    key: "kp_status" | "disability_status" | "special_attribute",
    value: string
  ) => {
    setFormData((prev) => {
      const selected = prev[key];
      const exists = selected.includes(value);
      return {
        ...prev,
        [key]: exists ? selected.filter((item) => item !== value) : [...selected, value],
      };
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !respondent) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Respondent not found</p>
        <Button onClick={() => router.push("/respondents")}>Back to Respondents</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Edit Respondent"
        description="Update respondent profile and detailed demographic information"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Respondents", href: "/respondents" },
          { label: respondent.full_name || respondent.unique_id, href: `/respondents/${respondent.id}` },
          { label: "Edit" },
        ]}
        actions={
          <Button variant="outline" onClick={handleBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Respondent Details</CardTitle>
          <CardDescription>Fields mirror the full respondent detail set from your mobile workflow.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="uniqueId">Unique ID *</Label>
              <Input
                id="uniqueId"
                value={formData.unique_id}
                readOnly
                disabled
              />
              <p className="text-xs text-muted-foreground">Auto-generated ID cannot be edited.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="organization">Organization *</Label>
              <OrganizationSelect
                organizations={organizations}
                value={formData.organization}
                onChange={(value) => setFormData((prev) => ({ ...prev, organization: value }))}
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
                value={formData.id_no}
                onChange={(e) => setFormData((prev) => ({ ...prev, id_no: e.target.value }))}
              />
            </div>
            {formData.is_anonymous ? (
              <div className="space-y-2">
                <Label htmlFor="ageRange">Age Range</Label>
                <Input
                  id="ageRange"
                  value={formData.age_range}
                  onChange={(e) => setFormData((prev) => ({ ...prev, age_range: e.target.value }))}
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
                  value={formData.first_name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, first_name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name *</Label>
                <Input
                  id="lastName"
                  value={formData.last_name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, last_name: e.target.value }))}
                />
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="gender">Gender *</Label>
              <Select
                value={formData.gender}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, gender: value }))}
              >
                <SelectTrigger id="gender">
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
                onChange={(e) => setFormData((prev) => ({ ...prev, date_of_birth: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="plotNo">Plot Number</Label>
              <Input
                id="plotNo"
                value={formData.plot_no}
                onChange={(e) => setFormData((prev) => ({ ...prev, plot_no: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ward">Ward</Label>
              <Input
                id="ward"
                value={formData.ward}
                onChange={(e) => setFormData((prev) => ({ ...prev, ward: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="village">Village/Town/City</Label>
              <Input
                id="village"
                value={formData.village}
                onChange={(e) => setFormData((prev) => ({ ...prev, village: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="district">District</Label>
              <Input
                id="district"
                value={formData.district}
                onChange={(e) => setFormData((prev) => ({ ...prev, district: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="citizenship">Citizenship</Label>
              <Input
                id="citizenship"
                value={formData.citizenship}
                onChange={(e) => setFormData((prev) => ({ ...prev, citizenship: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))}
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
                onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                value={formData.address}
                onChange={(e) => setFormData((prev) => ({ ...prev, address: e.target.value }))}
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
                onChange={(e) => setFormData((prev) => ({ ...prev, date_positive: e.target.value }))}
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              rows={2}
              value={formData.notes}
              onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
            />
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push(`/respondents/${respondent.id}`)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
