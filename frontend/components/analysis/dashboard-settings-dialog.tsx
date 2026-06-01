"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  dashboardSettingsService,
  type DashboardSetting,
  type DashboardSettingRequest,
} from "@/lib/api";
import { useAllOrganizations, useAllProjects } from "@/lib/hooks/use-api";

type DashboardSettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (dashboardId?: number) => Promise<void> | void;
  existing?: DashboardSetting | null;
};

function getInitialState(existing?: DashboardSetting | null) {
  return {
    name: existing?.name ?? "",
    description: existing?.description ?? "",
    projectId: existing?.project ? String(existing.project) : "all",
    organizationId: existing?.organization ? String(existing.organization) : "all",
    cascadeOrganization: Boolean(existing?.cascade_organization),
  };
}

export function DashboardSettingsDialog(props: DashboardSettingsDialogProps) {
  const { open, onOpenChange, onSaved, existing } = props;
  const { toast } = useToast();

  const { data: organizationsData } = useAllOrganizations();
  const { data: projectsData } = useAllProjects();

  const organizations = organizationsData?.results ?? [];
  const projects = projectsData?.results ?? [];

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("all");
  const [organizationId, setOrganizationId] = useState("all");
  const [cascadeOrganization, setCascadeOrganization] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    const next = getInitialState(existing);
    setName(next.name);
    setDescription(next.description);
    setProjectId(next.projectId);
    setOrganizationId(next.organizationId);
    setCascadeOrganization(next.cascadeOrganization);
  }, [existing, open]);

  useEffect(() => {
    if (organizationId === "all" && cascadeOrganization) {
      setCascadeOrganization(false);
    }
  }, [organizationId, cascadeOrganization]);

  const handleSave = async () => {
    if (saving) return;

    const trimmedName = name.trim();
    const trimmedDescription = description.trim();

    if (!trimmedName) {
      toast({
        title: "Dashboard name required",
        description: "Add a name before saving this dashboard.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const payload: DashboardSettingRequest = {
        name: trimmedName,
        description: trimmedDescription,
        project_id: projectId !== "all" ? Number(projectId) : null,
        organization_id: organizationId !== "all" ? Number(organizationId) : null,
        cascade_organization: organizationId !== "all" ? cascadeOrganization : false,
        charts: existing?.charts ?? [],
      };

      const saved = existing?.id
        ? await dashboardSettingsService.update(existing.id, payload)
        : await dashboardSettingsService.create(payload);

      await onSaved(saved.id);
      onOpenChange(false);

      toast({
        title: existing?.id ? "Dashboard updated" : "Dashboard created",
        description: saved.name,
      });
    } catch (error) {
      console.error("Failed to save dashboard", error);
      toast({
        title: "Save failed",
        description: "Unable to save this dashboard.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-[38rem]">
        <DialogHeader>
          <DialogTitle>{existing?.id ? "Edit Dashboard" : "Create Dashboard"}</DialogTitle>
          <DialogDescription>
            Configure the saved dashboard scope and description.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="dashboard-name">Dashboard name</Label>
            <Input
              id="dashboard-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Condom distribution"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="dashboard-description">Description</Label>
            <Textarea
              id="dashboard-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Short note about what this dashboard is tracking"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>Project scope</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="All projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All projects</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={String(project.id)}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Organization scope</Label>
              <Select value={organizationId} onValueChange={setOrganizationId}>
                <SelectTrigger>
                  <SelectValue placeholder="All organizations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All organizations</SelectItem>
                  {organizations.map((organization) => (
                    <SelectItem key={organization.id} value={String(organization.id)}>
                      {organization.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {organizationId !== "all" ? (
            <label className="flex items-center gap-3 rounded-lg border px-3 py-3 text-sm">
              <Checkbox
                checked={cascadeOrganization}
                onCheckedChange={(checked) => setCascadeOrganization(checked === true)}
              />
              <span>Include subgrantees</span>
            </label>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Dashboard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}