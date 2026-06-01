"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export type OrganizationSelectOption = {
  id: string | number;
  name: string;
};

export function OrganizationSelect(props: {
  organizations: OrganizationSelectOption[] | null | undefined | unknown;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  includeAll?: boolean;
  includeNone?: boolean;
  allLabel?: string;
  noneLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const {
    organizations,
    value,
    onChange,
    placeholder = "Select organization",
    includeAll = false,
    includeNone = false,
    allLabel = "All organizations",
    noneLabel = "General / none",
    disabled = false,
    className,
  } = props;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const safeOrganizations = useMemo<OrganizationSelectOption[]>(() => {
    if (!Array.isArray(organizations)) return [];

    return organizations.filter((organization): organization is OrganizationSelectOption => {
      if (!organization || typeof organization !== "object") return false;
      const candidate = organization as Partial<OrganizationSelectOption>;
      return (
        (typeof candidate.id === "string" || typeof candidate.id === "number") &&
        typeof candidate.name === "string"
      );
    });
  }, [organizations]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return safeOrganizations;
    return safeOrganizations.filter((org) => org.name.toLowerCase().includes(term));
  }, [safeOrganizations, search]);

  const selectedLabel = useMemo(() => {
    if (value === "all") return allLabel;
    if (value === "none") return noneLabel;
    const match = safeOrganizations.find((org) => String(org.id) === value);
    return match?.name || "";
  }, [value, safeOrganizations, allLabel, noneLabel]);

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
          <span className="truncate text-left">
            {selectedLabel || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="z-[60] w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput
            placeholder="Search organizations..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No organizations found.</CommandEmpty>
            <CommandGroup>
              {includeAll && (
                <CommandItem
                  value="all"
                  onSelect={() => {
                    onChange("all");
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4", value === "all" ? "opacity-100" : "opacity-0")}
                  />
                  {allLabel}
                </CommandItem>
              )}
              {includeNone && (
                <CommandItem
                  value="none"
                  onSelect={() => {
                    onChange("none");
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4", value === "none" ? "opacity-100" : "opacity-0")}
                  />
                  {noneLabel}
                </CommandItem>
              )}
              {filtered.map((org) => (
                <CommandItem
                  key={org.id}
                  value={org.name}
                  onSelect={() => {
                    onChange(String(org.id));
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === String(org.id) ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {org.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
