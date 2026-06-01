"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Download, Trash2, FileUp, RefreshCcw } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { OrganizationSelect } from "@/components/shared/organization-select";
import { uploadsService } from "@/lib/api";
import { useAllUploads, useImportJobs, useAllOrganizations } from "@/lib/hooks/use-api";
import type { UploadRecord } from "@/lib/api/services/uploads";
import { useToast } from "@/hooks/use-toast";

const FILE_TYPES = [
  { value: "all", label: "All Types" },
  { value: "document", label: "Document" },
  { value: "image", label: "Image" },
  { value: "spreadsheet", label: "Spreadsheet" },
  { value: "other", label: "Other" },
];

const SPREADSHEET_EXTENSIONS = [".xlsx", ".xls", ".xlsm", ".csv"];

function isSpreadsheetLikeUpload(upload: UploadRecord) {
  if (upload.file_type === "spreadsheet") return true;

  const value = String(upload.file_url || upload.file || upload.name || "").toLowerCase();
  return SPREADSHEET_EXTENSIONS.some((extension) => value.endsWith(extension));
}

export default function UploadsPage() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [fileTypeFilter, setFileTypeFilter] = useState("all");
  const [organizationFilter, setOrganizationFilter] = useState("all");
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [uploadForm, setUploadForm] = useState({
    name: "",
    description: "",
    organization: "none",
    content_type: "",
    object_id: "",
    file: null as File | null,
  });

  const { data: uploadsData, isLoading, error, mutate: mutateUploads } = useAllUploads();
  const { data: orgsData } = useAllOrganizations();
  const { data: importJobsData, mutate: mutateImports } = useImportJobs();

  const highlightedUploadId = useMemo(() => {
    const raw = searchParams.get("highlight");
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  }, [searchParams]);

  const uploads = useMemo(() => uploadsData?.results ?? [], [uploadsData?.results]);
  const organizations = orgsData?.results || [];
  const importJobs = importJobsData?.results || [];

  const filteredUploads = useMemo(() => {
    const query = search.toLowerCase();
    return uploads.filter((upload) => {
      const matchesSearch =
        upload.name.toLowerCase().includes(query) ||
        (upload.description || "").toLowerCase().includes(query) ||
        (upload.organization_name || "").toLowerCase().includes(query);
      const matchesType =
        fileTypeFilter === "all" || upload.file_type === fileTypeFilter;
      const matchesOrg =
        organizationFilter === "all" ||
        String(upload.organization || "") === organizationFilter;
      return matchesSearch && matchesType && matchesOrg;
    });
  }, [uploads, search, fileTypeFilter, organizationFilter]);

  const stats = useMemo(() => {
    const total = uploads.length;
    const spreadsheets = uploads.filter((u) => isSpreadsheetLikeUpload(u)).length;
    const documents = uploads.filter((u) => u.file_type === "document").length;
    const images = uploads.filter((u) => u.file_type === "image").length;
    return { total, spreadsheets, documents, images };
  }, [uploads]);

  useEffect(() => {
    if (!highlightedUploadId) return;

    const row = document.getElementById(`upload-row-${highlightedUploadId}`);
    if (!row) return;

    row.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedUploadId, filteredUploads.length, isLoading]);

  const resetForm = () => {
    setUploadForm({
      name: "",
      description: "",
      organization: "none",
      content_type: "",
      object_id: "",
      file: null,
    });
  };

  const handleUpload = async () => {
    if (!uploadForm.name || !uploadForm.file) {
      toast({
        title: "Missing required fields",
        description: "Name and file are required.",
        variant: "destructive",
      });
      return;
    }
    setIsSubmitting(true);
    try {
      await uploadsService.create({
        name: uploadForm.name,
        file: uploadForm.file,
        description: uploadForm.description || undefined,
        organization: uploadForm.organization && uploadForm.organization !== "none" ? Number(uploadForm.organization) : undefined,
        content_type: uploadForm.content_type || undefined,
        object_id: uploadForm.object_id ? Number(uploadForm.object_id) : undefined,
      });
      toast({ title: "Upload created", description: "File uploaded successfully." });
      resetForm();
      setIsUploadDialogOpen(false);
      mutateUploads();
    } catch (err) {
      console.error("Failed to upload", err);
      toast({
        title: "Upload failed",
        description: "Could not upload file.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (upload: UploadRecord) => {
    if (!confirm(`Delete "${upload.name}"?`)) return;
    try {
      await uploadsService.delete(upload.id);
      toast({ title: "Deleted", description: "Upload removed." });
      mutateUploads();
    } catch (err) {
      console.error("Failed to delete upload", err);
      toast({
        title: "Delete failed",
        description: "Could not delete upload.",
        variant: "destructive",
      });
    }
  };

  const handleStartImport = async (upload: UploadRecord) => {
    try {
      await uploadsService.startImport(upload.id);
      toast({ title: "Import queued", description: "Import job created and queued for review." });
      mutateImports();
    } catch (err) {
      console.error("Failed to start import", err);
      toast({
        title: "Import failed",
        description: "Could not start import job.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Uploads"
        description="Upload aggregates templates, reports, and supporting files."
        actions={
          <div className="flex flex-wrap gap-2">
            <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Plus className="h-4 w-4" />
                  New Upload
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>New Upload</DialogTitle>
                  <DialogDescription>Attach files for reports, templates, or datasets.</DialogDescription>
                </DialogHeader>

                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label>Name *</Label>
                    <Input
                      value={uploadForm.name}
                      onChange={(e) => setUploadForm({ ...uploadForm, name: e.target.value })}
                      placeholder="e.g. Q3 Aggregates Template"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label>Description</Label>
                    <Input
                      value={uploadForm.description}
                      onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
                      placeholder="Notes about this file"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label>Organization</Label>
                    <OrganizationSelect
                      organizations={organizations}
                      value={uploadForm.organization}
                      onChange={(value) => setUploadForm({ ...uploadForm, organization: value })}
                      includeNone
                      noneLabel="General / none"
                      placeholder="Select organization"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label>Linked Content Type (optional)</Label>
                    <Input
                      value={uploadForm.content_type}
                      onChange={(e) => setUploadForm({ ...uploadForm, content_type: e.target.value })}
                      placeholder="e.g. aggregates.Aggregate"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label>Linked Object ID (optional)</Label>
                    <Input
                      value={uploadForm.object_id}
                      onChange={(e) => setUploadForm({ ...uploadForm, object_id: e.target.value })}
                      placeholder="e.g. 123"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label>File *</Label>
                    <Input
                      type="file"
                      onChange={(e) =>
                        setUploadForm({
                          ...uploadForm,
                          file: e.target.files ? e.target.files[0] : null,
                        })
                      }
                    />
                  </div>
                </div>

                <DialogFooter className="pt-2">
                  <Button variant="outline" onClick={() => setIsUploadDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleUpload} disabled={isSubmitting}>
                    {isSubmitting ? "Uploading..." : "Upload"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Total Uploads</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{stats.total}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Spreadsheets</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{stats.spreadsheets}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Documents</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{stats.documents}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Images</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{stats.images}</CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search uploads..."
            className="pl-9"
          />
        </div>

        <Select value={fileTypeFilter} onValueChange={setFileTypeFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="File type" />
          </SelectTrigger>
          <SelectContent>
            {FILE_TYPES.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

                <OrganizationSelect
          organizations={organizations}
          value={organizationFilter}
          onChange={setOrganizationFilter}
          includeAll
          allLabel="All organizations"
          placeholder="Organization"
          className="w-[220px]"
        /></div>

      {error && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            Failed to load uploads. Please check your API connection.
          </CardContent>
        </Card>
      )}

      {!error && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Uploads</CardTitle>
            <Badge variant="secondary">{filteredUploads.length} records</Badge>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCcw className="h-4 w-4 animate-spin" />
                Loading uploads...
              </div>
            ) : filteredUploads.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No uploads found.
              </div>
            ) : (
              <div className="space-y-4">
                {filteredUploads.map((upload) => (
                  <div
                    key={upload.id}
                    id={`upload-row-${upload.id}`}
                    className={`rounded-lg border border-border p-4 transition-colors ${
                      highlightedUploadId === upload.id ? "border-primary bg-primary/5 shadow-sm" : ""
                    }`}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-medium">{upload.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {upload.organization_name || "General"} • {upload.file_type}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {upload.file_url && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => window.open(upload.file_url || upload.file, "_blank")}
                          >
                            <Download className="mr-2 h-4 w-4" />
                            Download
                          </Button>
                        )}
                        {isSpreadsheetLikeUpload(upload) && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleStartImport(upload)}
                          >
                            <FileUp className="mr-2 h-4 w-4" />
                            Start Import
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(upload)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {upload.description && (
                      <p className="mt-2 text-sm text-muted-foreground">{upload.description}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Import Jobs</CardTitle>
            <Button asChild variant="outline" size="sm">
              <Link href="/uploads/imports">View all imports</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {importJobs.length === 0 ? (
            <div className="text-sm text-muted-foreground">No import jobs yet.</div>
          ) : (
            <div className="space-y-3">
              {importJobs.map((job) => (
                <div key={job.id} className="flex items-center justify-between rounded-lg border border-border px-4 py-3 text-sm">
                  <div>
                    <div className="font-medium">{job.upload_name || `Upload #${job.upload}`}</div>
                    <div className="text-xs text-muted-foreground">Status: {job.status}</div>
                  </div>
                  <Badge variant={job.status === "completed" ? "default" : "secondary"}>
                    {job.progress}%
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


