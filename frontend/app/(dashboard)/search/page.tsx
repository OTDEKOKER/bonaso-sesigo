"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import useSWR from "swr"
import { Building2, FolderKanban, Loader2, Search, UserRound, Users } from "lucide-react"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { organizationsService, projectsService, respondentsService, usersService } from "@/lib/api"
import { getUserRoleLabel } from "@/lib/roles"

function EmptyQueryState() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <Search className="h-6 w-6" />
      </div>
      <h2 className="mt-4 text-xl font-semibold text-foreground">Search the portal</h2>
      <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
        Enter a name, code, email, or identifier to find matching respondents, projects, organizations, and users.
      </p>
    </div>
  )
}

interface SearchSectionProps {
  title: string
  description: string
  icon: React.ReactNode
  isLoading: boolean
  count: number
  emptyMessage: string
  children: React.ReactNode
}

function SearchSection(props: SearchSectionProps) {
  const { title, description, icon, isLoading, count, emptyMessage, children } = props

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-secondary p-2.5 text-muted-foreground">
            {icon}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
          {isLoading ? "Loading..." : `${count} match${count === 1 ? "" : "es"}`}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {isLoading ? (
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-background px-4 py-5 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Searching {title.toLowerCase()}...
          </div>
        ) : count === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-background px-4 py-5 text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  )
}

export default function SearchPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const query = useMemo(() => searchParams.get("q")?.trim() ?? "", [searchParams])
  const [draftQuery, setDraftQuery] = useState(query)

  useEffect(() => {
    setDraftQuery(query)
  }, [query])

  const respondentResults = useSWR(
    query ? ["global-search-respondents", query] : null,
    () => respondentsService.list({ search: query, page_size: "5" }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  )
  const projectResults = useSWR(
    query ? ["global-search-projects", query] : null,
    () => projectsService.list({ search: query, page_size: "5" }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  )
  const organizationResults = useSWR(
    query ? ["global-search-organizations", query] : null,
    () => organizationsService.list({ search: query, page_size: "5" }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  )
  const userResults = useSWR(
    query ? ["global-search-users", query] : null,
    () => usersService.list({ search: query, page_size: "5" }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  )

  const hasQuery = query.length > 0
  const anyError = respondentResults.error || projectResults.error || organizationResults.error || userResults.error

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedQuery = draftQuery.trim()
    if (!trimmedQuery) {
      router.push("/search")
      return
    }
    router.push(`/search?q=${encodeURIComponent(trimmedQuery)}`)
  }

  const respondents = respondentResults.data?.results ?? []
  const projects = projectResults.data?.results ?? []
  const organizations = organizationResults.data?.results ?? []
  const users = userResults.data?.results ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Global Search"
        description="Search across respondents, projects, organizations, and users from one place."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Search" },
        ]}
      />

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
              placeholder="Search respondents, projects, organizations, or users..."
              className="pl-9"
              aria-label="Global portal search"
            />
          </div>
          <Button type="submit">Search</Button>
        </form>
        {hasQuery ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Showing up to 5 matches per section for <span className="font-medium text-foreground">{query}</span>.
          </p>
        ) : null}
      </section>

      {!hasQuery ? <EmptyQueryState /> : null}

      {hasQuery && anyError ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Some search results could not be loaded right now. Try again in a moment.
        </div>
      ) : null}

      {hasQuery ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <SearchSection
            title="Respondents"
            description="Matches from tracked people and their portal records."
            icon={<Users className="h-5 w-5" />}
            isLoading={respondentResults.isLoading}
            count={respondentResults.data?.count ?? respondents.length}
            emptyMessage="No respondents matched this search."
          >
            {respondents.map((respondent) => {
              const fullName = respondent.full_name || `${respondent.first_name} ${respondent.last_name}`.trim() || respondent.unique_id
              return (
                <Link
                  key={respondent.id}
                  href={`/respondents/${respondent.id}`}
                  className="block rounded-xl border border-border bg-background px-4 py-3 transition-colors hover:bg-muted"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium text-foreground">{fullName}</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        ID: {respondent.unique_id}
                      </div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      {respondent.organization_name || "Organization not set"}
                    </div>
                  </div>
                </Link>
              )
            })}
          </SearchSection>

          <SearchSection
            title="Projects"
            description="Matches from current and archived project records."
            icon={<FolderKanban className="h-5 w-5" />}
            isLoading={projectResults.isLoading}
            count={projectResults.data?.count ?? projects.length}
            emptyMessage="No projects matched this search."
          >
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="block rounded-xl border border-border bg-background px-4 py-3 transition-colors hover:bg-muted"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium text-foreground">{project.name}</div>
                  </div>
                  <div className="text-right text-xs uppercase tracking-wide text-muted-foreground">
                    {project.status}
                  </div>
                </div>
              </Link>
            ))}
          </SearchSection>

          <SearchSection
            title="Organizations"
            description="Matches from partner, district, and parent organization records."
            icon={<Building2 className="h-5 w-5" />}
            isLoading={organizationResults.isLoading}
            count={organizationResults.data?.count ?? organizations.length}
            emptyMessage="No organizations matched this search."
          >
            {organizations.map((organization) => (
              <Link
                key={organization.id}
                href={`/organizations/${organization.id}`}
                className="block rounded-xl border border-border bg-background px-4 py-3 transition-colors hover:bg-muted"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium text-foreground">{organization.name}</div>
                  </div>
                  <div className="text-right text-xs uppercase tracking-wide text-muted-foreground">
                    {organization.type}
                  </div>
                </div>
              </Link>
            ))}
          </SearchSection>

          <SearchSection
            title="Users"
            description="Matches from portal accounts and staff records."
            icon={<UserRound className="h-5 w-5" />}
            isLoading={userResults.isLoading}
            count={userResults.data?.count ?? users.length}
            emptyMessage="No users matched this search."
          >
            {users.map((user) => {
              const userRecord = user as unknown as Record<string, unknown>
              const firstName = String((userRecord.firstName ?? userRecord.first_name ?? "") as string).trim()
              const lastName = String((userRecord.lastName ?? userRecord.last_name ?? "") as string).trim()
              const fullName = [firstName, lastName].filter(Boolean).join(" ") || String(user.email || "Unnamed user")

              return (
                <Link
                  key={user.id}
                  href={`/users/${user.id}`}
                  className="block rounded-xl border border-border bg-background px-4 py-3 transition-colors hover:bg-muted"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium text-foreground">{fullName}</div>
                      <div className="mt-1 text-sm text-muted-foreground">{user.email}</div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      {getUserRoleLabel(user.role)}
                    </div>
                  </div>
                </Link>
              )
            })}
          </SearchSection>
        </div>
      ) : null}
    </div>
  )
}
