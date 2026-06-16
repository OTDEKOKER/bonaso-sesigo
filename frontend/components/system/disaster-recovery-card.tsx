"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  History,
  Loader2,
  ShieldAlert,
  Upload,
  XCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  systemService,
  type RestoreHistoryEntry,
  type RestoreValidationResult,
} from "@/lib/api";

type Step = "upload" | "review" | "confirm";

const RESULT_TONE: Record<string, string> = {
  success: "bg-emerald-600",
  validated: "bg-sky-600",
  rolled_back: "bg-amber-500",
  failed: "bg-destructive",
  rejected: "bg-destructive",
  pending: "bg-muted-foreground",
};

function HistoryTable({ rows }: { rows: RestoreHistoryEntry[] }) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">No restore activity recorded yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-muted-foreground">
          <tr>
            <th className="py-2 pr-4">When</th>
            <th className="py-2 pr-4">By</th>
            <th className="py-2 pr-4">Backup</th>
            <th className="py-2 pr-4">Source → Target</th>
            <th className="py-2 pr-4">Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t">
              <td className="py-2 pr-4 whitespace-nowrap">{new Date(row.created_at).toLocaleString()}</td>
              <td className="py-2 pr-4">{row.restored_by || "—"}</td>
              <td className="py-2 pr-4">{row.backup_name || "—"}</td>
              <td className="py-2 pr-4 whitespace-nowrap">
                {row.source_environment} → {row.target_environment}
                {row.environment_override ? <Badge variant="destructive" className="ml-2">override</Badge> : null}
              </td>
              <td className="py-2 pr-4">
                <Badge className={RESULT_TONE[row.result] ?? "bg-muted-foreground"}>{row.result}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DisasterRecoveryCard() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [result, setResult] = useState<RestoreValidationResult | null>(null);
  const [typed, setTyped] = useState("");
  const [history, setHistory] = useState<RestoreHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = async () => {
    try {
      const data = await systemService.getRestoreHistory();
      setHistory(data.results);
    } catch {
      /* non-fatal */
    }
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  const onValidate = async () => {
    if (!file) return;
    setIsValidating(true);
    try {
      const res = await systemService.validateRestore(file);
      setResult(res);
      setStep("review");
      void loadHistory();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Validation failed",
        description: err instanceof Error ? err.message : "The backup could not be validated.",
      });
    } finally {
      setIsValidating(false);
    }
  };

  const reset = () => {
    setStep("upload");
    setFile(null);
    setResult(null);
    setTyped("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const canProceed = typed.trim() === "RESTORE";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4" />
          Disaster Recovery — Restore
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => setShowHistory((v) => !v)}>
          <History className="mr-2 h-4 w-4" />
          {showHistory ? "Hide history" : "Restore history"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Restores are applied on the server, not from this page.</AlertTitle>
          <AlertDescription>
            Upload a backup to validate it and confirm intent. The actual database overwrite is
            performed by an operator running the supervised <code>restore_backup</code> command,
            which takes a pre-restore safety backup and rolls back automatically on failure.
          </AlertDescription>
        </Alert>

        {/* Step 1: upload */}
        {step === "upload" ? (
          <div className="space-y-3">
            <Input
              ref={fileRef}
              type="file"
              accept=".dump,.sql,.zip"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button onClick={() => void onValidate()} disabled={!file || isValidating}>
              {isValidating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Upload &amp; validate
            </Button>
          </div>
        ) : null}

        {/* Step 2: review */}
        {step === "review" && result ? (
          <div className="space-y-3">
            <div className="grid gap-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                {result.valid ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                <span className="font-medium">{result.valid ? "Backup is valid" : "Backup is NOT valid"}</span>
              </div>
              <div className="flex justify-between"><span className="text-muted-foreground">File</span><span>{result.filename}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Created</span><span>{result.created_at || "Unknown"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Archive integrity</span><span>{result.archive_ok ? "OK" : "Failed"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Checksum</span><span>{result.checksum_ok === null ? "No manifest" : result.checksum_ok ? "Match" : "Mismatch"}</span></div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Environment</span>
                <span>{result.source_environment} → {result.target_environment}</span>
              </div>
            </div>

            {result.errors.length ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Validation problems</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-5">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>
                </AlertDescription>
              </Alert>
            ) : null}

            {result.environment_conflict ? (
              <Alert variant="destructive">
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>Environment contamination risk</AlertTitle>
                <AlertDescription>
                  This {result.source_environment} backup would be restored into a{" "}
                  {result.target_environment} system. This is blocked unless an operator passes{" "}
                  <code>--override OVERRIDE</code>.
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="flex gap-2">
              <Button onClick={() => setStep("confirm")} disabled={!result.valid}>Continue</Button>
              <Button variant="outline" onClick={reset}>Start over</Button>
            </div>
          </div>
        ) : null}

        {/* Step 3: confirm -> reveal operator command */}
        {step === "confirm" && result ? (
          <div className="space-y-3">
            <p>
              Type <span className="font-mono font-semibold">RESTORE</span> to reveal the exact command
              the operator must run on the server.
            </p>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="RESTORE" />
            {canProceed ? (
              <div className="space-y-2">
                <p className="text-muted-foreground">Run this on the server (backend dir):</p>
                <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">{result.apply_command}</pre>
                {result.environment_conflict ? (
                  <p className="text-xs text-destructive">
                    Includes <code>--override OVERRIDE</code> because of the environment mismatch — every
                    override is audit-logged.
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button variant="outline" onClick={reset}>Done</Button>
            </div>
          </div>
        ) : null}

        {showHistory ? (
          <>
            <Separator />
            <HistoryTable rows={history} />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
