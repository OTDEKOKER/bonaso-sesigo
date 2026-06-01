"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type OrganizationOption = {
  id: string | number;
  name: string;
};

type OrganizationMultiSelectProps = {
  allLabel?: string;
  className?: string;
  disabled?: boolean;
  emptyMeansAll?: boolean;
  emptyLabel?: string;
  organizations: OrganizationOption[];
  showSelectAll?: boolean;
  placeholder?: string;
  selectedIds: string[];
  selectAllLabel?: string;
  onChange: (nextSelectedIds: string[]) => void;
};

export function OrganizationMultiSelect(props: OrganizationMultiSelectProps) {
  const {
    allLabel = "All organizations",
    className,
    disabled = false,
    emptyMeansAll = false,
    emptyLabel,
    organizations,
    placeholder = "Select organizations",
    selectedIds,
    selectAllLabel,
    showSelectAll = true,
    onChange,
  } = props;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedSet = useMemo(() => new Set(selectedIds.map((id) => String(id))), [selectedIds]);
  const allSelected = organizations.length > 0 && selectedSet.size === organizations.length;

  const filteredOrganizations = useMemo(() => {
    const searchText = query.trim().toLowerCase();
    if (!searchText) return organizations;
    return organizations.filter((organization) =>
      String(organization.name || "").toLowerCase().includes(searchText),
    );
  }, [organizations, query]);

  const summaryLabel = useMemo(() => {
    if (organizations.length === 0) return "No organizations";
    if (selectedSet.size === 0) {
      return emptyMeansAll ? allLabel : emptyLabel || placeholder;
    }
    if (allSelected) return allLabel;
    if (selectedSet.size === 1) {
      const singleId = Array.from(selectedSet)[0];
      return organizations.find((organization) => String(organization.id) === singleId)?.name || allLabel;
    }
    return `${selectedSet.size} organizations selected`;
  }, [allLabel, allSelected, emptyLabel, emptyMeansAll, organizations, placeholder, selectedSet]);

  const toggleOrganization = (organizationId: string) => {
    if (selectedSet.has(organizationId)) {
      onChange(selectedIds.filter((id) => String(id) !== organizationId));
      return;
    }
    onChange([...selectedIds, organizationId]);
  };

  const toggleAll = () => {
    if (allSelected) {
      onChange([]);
      return;
    }
    onChange(organizations.map((organization) => String(organization.id)));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between", className)}
          disabled={disabled}
        >
          <span className="truncate text-left">{summaryLabel || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="z-[60] w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder="Search organizations..." value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>No organizations found.</CommandEmpty>
            <CommandGroup>
              {showSelectAll ? (
                <CommandItem
                  value="all-organizations"
                  onSelect={(eventValue) => {
                    if (!eventValue) return;
                    toggleAll();
                  }}
                >
                  <div className="mr-2 flex h-4 w-4 items-center justify-center">
                    <Check className={cn("h-4 w-4", selectedSet.size === 0 || allSelected ? "opacity-100" : "opacity-0")} />
                  </div>
                  {selectAllLabel || allLabel}
                </CommandItem>
              ) : null}
              {filteredOrganizations.map((organization) => {
                const organizationId = String(organization.id);
                return (
                  <CommandItem
                    key={organizationId}
                    value={`${organization.name}-${organizationId}`}
                    onSelect={() => toggleOrganization(organizationId)}
                  >
                    <Checkbox checked={selectedSet.has(organizationId)} className="mr-2 pointer-events-none" />
                    <span className="truncate">{organization.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
