import { redirect } from "next/navigation";

// The standalone Reports & Analysis hub was consolidated into the Analysis
// section. Keep this route as a permanent redirect for old links/bookmarks.
export default function ReportsRedirect() {
  redirect("/analysis/reports");
}
