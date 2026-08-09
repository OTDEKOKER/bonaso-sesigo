"use client";

import { ShieldAlert } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { BotswanaCsoMap } from "@/components/cso-mapping/botswana-map";
import { useModulePermissions } from "@/lib/permissions/module-permissions";

/**
 * Authorised-staff CSO location map. Lives in the dashboard shell (inherits the
 * app's authentication) and is gated by the CSO Mapping module — the same
 * deny-by-default control as the submissions page.
 */
export default function CsoMappingMapPage() {
  const { canView } = useModulePermissions();

  if (!canView("cso_mapping")) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="CSO Map"
          description="Map of Civil Society Organisations in Botswana"
        />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <ShieldAlert className="h-8 w-8 text-amber-500" />
            <p className="text-sm font-medium text-slate-700">Restricted</p>
            <p className="max-w-sm text-xs text-slate-500">
              CSO location data is controlled organisational data. Ask an administrator to grant you
              the CSO Mapping module.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="CSO Map"
        description="Map of Civil Society Organisations in Botswana"
      />
      <BotswanaCsoMap />
    </div>
  );
}
