import { redirect } from "next/navigation";

// Mirrors the live /reports redirect, but keeps the user inside training mode.
export default function TrainingReportsRedirect() {
  redirect("/training/analysis/reports");
}
