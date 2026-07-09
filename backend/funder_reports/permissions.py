"""Permissions + org scoping for the Funder Report Builder.

Self-service model — configuration is NOT admin-only. Any authorized user may
create and OWN personal templates/figures and generate scoped data; who can EDIT
a given config object is decided per-object by ``can_edit_report_object`` (admin,
the template owner, or an M&E Manager on a shared system template). Data is always
re-scoped to the viewer, so broad builder access never widens data access.

  * Admin        — edit anything; view all data in scope.
  * Manager      — own personal reports + curate shared/system templates; export;
                   may include pending data (approver).
  * M&E Officer  — own personal reports; generate/export approved data in scope.
  * Coordinator  — own personal reports; generate for their org + descendants.
  * Client/funder— own personal dashboards from APPROVED/PUBLISHED data they may
                   see; export allowed outputs; no config of others, no pending.
  * Collector    — no access unless explicitly an admin.
"""
from __future__ import annotations

from rest_framework.permissions import BasePermission, SAFE_METHODS

from organizations.access import is_organization_admin, get_user_organization_ids
from projects.hierarchy import resolve_organization_scope_with_project_hierarchy


def _role(user) -> str:
    return getattr(user, 'role', '') or ''


# NOTE: report configuration is NOT admin-only. Creating a template is allowed
# for any report user (self-service, owner = creator); EDITING a config object is
# governed by ``can_edit_report_object`` (admin OR the template owner OR an M&E
# Manager on a shared system template). There is deliberately no admin-only
# "can_configure_reports" gate — it was removed so non-admins and funders can
# build their own reports within their permission scope.


def can_edit_mappings(user) -> bool:
    """Edit indicator mappings / filters / chart settings on a figure. Admin, plus
    M&E Managers (a manager owns their programme's figure definitions). Officers
    do NOT edit mappings unless they are admins."""
    return bool(user and user.is_authenticated and (
        is_organization_admin(user) or _role(user) == 'manager'
    ))


def can_use_reports(user) -> bool:
    """Self-service access: ANY authorized user — including funder/client users —
    may open the builder, create their OWN personal templates/charts, generate
    scoped previews, save personal views and export what they are allowed to see.
    Data is always re-scoped to the viewer server-side, so this grants UI access,
    never data access. Data collectors are excluded unless they are admins."""
    return bool(user and user.is_authenticated and (
        is_organization_admin(user) or _role(user) in {'manager', 'officer', 'coordinator', 'client'}
    ))


def can_generate_reports(user) -> bool:
    """Run previews / generate dashboards (scoped). Same audience as use."""
    return can_use_reports(user)


def can_edit_narrative(user) -> bool:
    return bool(user and user.is_authenticated and (
        is_organization_admin(user) or _role(user) in {'manager', 'officer'}
    ))


def can_save_snapshot(user) -> bool:
    return can_generate_reports(user) and _role(user) != 'coordinator' or is_organization_admin(user)


def can_export_reports(user) -> bool:
    """Export the data/charts the user is allowed to see (funders included — the
    export is re-scoped to their permissions, like every other read path)."""
    return can_use_reports(user)


def template_of(obj):
    """Resolve the owning ReportTemplate for any config object."""
    from .models import ReportTemplate, ReportSection, ReportFigure
    if isinstance(obj, ReportTemplate):
        return obj
    if isinstance(obj, ReportSection):
        return obj.report_template
    if isinstance(obj, ReportFigure):
        return obj.report_section.report_template
    figure = getattr(obj, 'report_figure', None)  # mapping / filter
    if figure is not None:
        return figure.report_section.report_template
    return None


def can_edit_report_object(user, obj) -> bool:
    """Config edits are allowed for:
      * admins (anything);
      * the template OWNER (their own personal chart — self-service);
      * M&E Managers on SYSTEM/shared templates (owner is None, e.g. the seeded
        NAHPA report) — they curate the organisation's funder reports, e.g.
        finishing the partial figure mappings.
    This makes the builder self-service without letting one user edit another
    user's personal charts."""
    if is_organization_admin(user):
        return True
    tmpl = template_of(obj)
    if not tmpl or not user:
        return False
    if tmpl.owner_id and tmpl.owner_id == user.id:
        return True
    return tmpl.owner_id is None and _role(user) == 'manager'


def can_publish_reports(user) -> bool:
    """Finalize/publish a snapshot (locks it for funder sharing). Admin/manager."""
    return bool(user and user.is_authenticated and (
        is_organization_admin(user) or _role(user) == 'manager'
    ))


def can_view_unapproved(user) -> bool:
    """Only APPROVERS (M&E Managers / admins) may include pending/review data in a
    funder report; everyone else — including M&E Officers who merely mark-review —
    is restricted to APPROVED aggregates, since funder outputs must reflect signed
    -off data."""
    from organizations.access import can_approve_aggregates
    return bool(user and user.is_authenticated and (
        is_organization_admin(user) or can_approve_aggregates(user)
    ))


# Read-only / data-generation actions (not config edits).
_GENERATE_ACTIONS = {'preview', 'generate', 'export', 'export_word', 'save_snapshot'}
# Config-edit detail actions (object ownership enforced in has_object_permission).
_EDIT_ACTIONS = {'mappings', 'duplicate', 'set_active', 'update', 'partial_update', 'destroy'}


class ReportBuilderPermission(BasePermission):
    """Self-service model. ANY authorized user (incl. funders) may read, generate
    scoped data, and create/own personal templates+figures. EDITING a config
    object is allowed only for admins or the object's template OWNER — enforced at
    the object level. Publishing stays admin/manager. Data is always re-scoped to
    the viewer, so broad UI access never widens data access."""

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        action = getattr(view, 'action', None)
        if action in _GENERATE_ACTIONS:
            return (can_export_reports if action in ('export', 'export_word') else
                    can_save_snapshot if action == 'save_snapshot' else can_generate_reports)(user)
        if action == 'publish':
            return can_publish_reports(user)
        if request.method in SAFE_METHODS:
            return can_use_reports(user)
        if action == 'create':
            # Self-service create: allowed for any report user. Nested creates
            # (section/figure/mapping/filter) additionally verify parent ownership
            # in the view's perform_create.
            return can_use_reports(user)
        # Remaining writes (update/partial_update/destroy/detail edit actions) are
        # object-scoped — deferred to has_object_permission.
        return can_use_reports(user)

    def has_object_permission(self, request, view, obj):
        user = request.user
        action = getattr(view, 'action', None)
        if request.method in SAFE_METHODS or action in _GENERATE_ACTIONS:
            return can_use_reports(user)
        if action == 'publish':
            return can_publish_reports(user)
        if action in _EDIT_ACTIONS or request.method not in SAFE_METHODS:
            return can_edit_report_object(user, obj)
        return can_use_reports(user)


def visible_templates(queryset, user):
    """Filter templates to those the user may SEE: their own, ones shared with
    them, system templates (owner is None, e.g. the seeded NAHPA report), plus
    org/project/public visibility they belong to. Sharing controls who can OPEN
    and customize a chart definition; the data each viewer then sees is still
    re-scoped by ``allowed_org_ids_for_report`` at generation time, so a shared
    chart can never leak data outside the viewer's scope."""
    from django.db.models import Q
    if is_organization_admin(user):
        return queryset
    org_ids = list(get_user_organization_ids(user))
    q = (
        Q(owner=user)
        | Q(shared_with_users=user)
        | Q(owner__isnull=True)                 # system/seeded templates
        | Q(visibility='public')
        | Q(visibility='organization', owner__organization_id__in=org_ids or [0])
        | Q(visibility__in=['project', 'network', 'funder'], project__assigned_users=user)
    )
    return queryset.filter(q).distinct()


def allowed_org_ids_for_report(user, project) -> set[int] | None:
    """Org scope for report generation. ``None`` means unrestricted (admins).

    Non-admins are limited to their organization(s) and descendants, resolved
    through the project hierarchy — identical scoping to the aggregate reads, so
    a funder figure can never surface data the user could not already see.
    """
    if is_organization_admin(user):
        return None
    scope: set[int] = set()
    for org_id in get_user_organization_ids(user):
        scope |= resolve_organization_scope_with_project_hierarchy(org_id, project=project)
    return scope


# Filter keys the client may send; anything else is ignored server-side.
_ALLOWED_FILTER_KEYS = {
    'organization', 'coordinator', 'district', 'sex', 'age', 'age_range',
    'key_population', 'kvp', 'message_type', 'service_category', 'indicator',
    'indicator_group',
}


def _as_list(value):
    if value is None or value == '':
        return []
    if isinstance(value, (list, tuple, set)):
        return [v for v in value if v not in (None, '')]
    return [value]


def scoped_org_filter(user, project, allowed_org_ids, *, organization=None, coordinator=None):
    """Resolve an org/coordinator FILTER into a concrete set of org ids that is
    GUARANTEED to be within the user's allowed scope. This is the anti-escape
    guard: a coordinator/officer can pass ?organization=<other CSO> or
    ?coordinator=<other coordinator>, but the result is always intersected with
    what they may already see, so params can never widen scope.

    Returns a set of org ids to restrict to, or ``None`` for "no org filter"
    (still bounded by ``allowed_org_ids`` in the generator)."""
    requested: set[int] = set()
    have_request = False
    for oid in _as_list(organization):
        try:
            requested.add(int(oid)); have_request = True
        except (TypeError, ValueError):
            continue
    for cid in _as_list(coordinator):
        try:
            requested |= resolve_organization_scope_with_project_hierarchy(int(cid), project=project)
            have_request = True
        except (TypeError, ValueError):
            continue
    if not have_request:
        return None
    if allowed_org_ids is None:  # admin — unrestricted, honour the request as-is
        return requested
    return requested & allowed_org_ids  # never widen beyond allowed scope


def build_scoped_filters(request, user, project, allowed_org_ids):
    """Turn raw request data/params into a normalized, scope-safe filter dict for
    the generation service. Org/coordinator filters are intersected with the
    caller's allowed scope; the effective org restriction is returned separately
    so the generator enforces it regardless of the other filters."""
    data = {**getattr(request, 'query_params', {}), **getattr(request, 'data', {})}
    filters: dict = {}
    for key in _ALLOWED_FILTER_KEYS:
        if key in ('organization', 'coordinator'):
            continue
        values = _as_list(data.get(key))
        if values:
            filters[key] = values

    org_restrict = scoped_org_filter(
        user, project, allowed_org_ids,
        organization=data.get('organization'), coordinator=data.get('coordinator'),
    )
    # Approval status: only reviewers/approvers may include unapproved data.
    include_unapproved = str(data.get('include_unapproved') or data.get('approval_status') or '').lower() in (
        'true', 'all', 'pending', 'include_pending',
    )
    return filters, org_restrict, include_unapproved
