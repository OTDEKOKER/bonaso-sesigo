"""User-level module permissions — catalog, role defaults, and resolution.

Extends (does NOT replace) the role system: roles provide *default* module
access, and admins may override per user via ``UserModulePermission`` rows.

Resolution hierarchy (deny-by-default):
  1. Superuser/staff/admin  -> every module, every action.
  2. User-specific row for a module -> overrides that module's actions
     (a disabled row means the module is explicitly denied -> no actions).
  3. No user-specific row for a module -> the user's role default.
  4. Module in neither -> denied.

Defaults are computed on read (not materialised), so an existing user is never
broken and a later role change is reflected immediately without a data backfill.
"""
from __future__ import annotations

# --- Module / action catalog ------------------------------------------------

MODULE_ACTIONS: dict[str, list[str]] = {
    'dashboard': ['view'],
    'organizations': ['view', 'create', 'edit', 'delete', 'manage'],
    'users': ['view', 'create', 'edit', 'deactivate', 'reset_password'],
    'projects': ['view', 'create', 'edit', 'delete', 'manage'],
    'indicators': ['view', 'create', 'edit', 'delete'],
    'targets': ['view', 'create', 'edit', 'delete', 'manage'],
    'respondents': ['view', 'create', 'edit', 'delete', 'export'],
    'aggregates': ['view', 'create', 'edit', 'submit', 'review', 'approve', 'reject', 'export'],
    'events': ['view', 'create', 'edit', 'delete'],
    'uploads': ['view', 'import', 'export'],
    'reports': ['view', 'generate', 'export'],
    'analytics': ['view', 'export'],
    'messages': ['view', 'create'],
    'notifications': ['view'],
    'social': ['view', 'create', 'edit', 'delete'],
    'flags': ['view', 'create', 'edit', 'resolve'],
    'support': ['view', 'create', 'edit', 'delete', 'assign', 'resolve'],
    'system_status': ['view'],
    'settings': ['view', 'manage'],
    'training_mode': ['view'],
    'batch_record': ['view', 'import', 'export'],
}

MODULES: list[str] = list(MODULE_ACTIONS.keys())


def all_actions_for(module: str) -> list[str]:
    return list(MODULE_ACTIONS.get(module, []))


# --- Role defaults ----------------------------------------------------------
# Security defaults baked in: clients get no data-entry; collectors cannot
# approve; officers cannot approve (review/reject only).

def _full(*modules: str) -> dict[str, list[str]]:
    return {module: all_actions_for(module) for module in modules}


ROLE_MODULE_DEFAULTS: dict[str, dict[str, list[str]]] = {
    'manager': {
        'dashboard': ['view'],
        'projects': ['view', 'create', 'edit', 'manage'],
        'indicators': ['view', 'create', 'edit'],
        'targets': ['view', 'create', 'edit', 'manage'],
        'aggregates': ['view', 'create', 'submit', 'review', 'approve', 'reject', 'export'],
        'reports': ['view', 'generate', 'export'],
        'analytics': ['view', 'export'],
        'notifications': ['view'],
        'messages': ['view', 'create'],
        # Managers are front-line support staff: full triage of the help desk.
        'support': ['view', 'create', 'edit', 'delete', 'assign', 'resolve'],
    },
    'officer': {
        'dashboard': ['view'],
        'projects': ['view'],
        'indicators': ['view'],
        'aggregates': ['view', 'create', 'submit', 'review', 'reject', 'export'],
        'reports': ['view', 'export'],
        'notifications': ['view'],
        'messages': ['view', 'create'],
        # Officers triage help-desk tickets but cannot delete them.
        'support': ['view', 'create', 'edit', 'assign', 'resolve'],
    },
    'collector': {
        'dashboard': ['view'],
        'aggregates': ['view', 'create', 'submit', 'export'],
        'events': ['view', 'create'],
        'batch_record': ['view', 'import'],
        'notifications': ['view'],
        # Collectors may raise and follow their own tickets.
        'support': ['view', 'create'],
    },
    'client': {
        'dashboard': ['view'],
        'reports': ['view'],
        'analytics': ['view'],
        'notifications': ['view'],
        # Clients/funders may raise and follow their own tickets.
        'support': ['view', 'create'],
    },
}


def _is_admin(user) -> bool:
    return bool(
        user and (
            getattr(user, 'is_superuser', False)
            or getattr(user, 'is_staff', False)
            or getattr(user, 'role', None) == 'admin'
        )
    )


def get_role_defaults(role: str | None) -> dict[str, list[str]]:
    """Default module->actions for a role. Admin gets everything."""
    if role == 'admin':
        return {module: all_actions_for(module) for module in MODULES}
    return {module: list(actions) for module, actions in ROLE_MODULE_DEFAULTS.get(role or '', {}).items()}


def resolve_user_module_permissions(user, rows=None) -> dict[str, list[str]]:
    """Effective module->actions for a user (custom overrides on role defaults).

    ``rows`` may be a pre-fetched list of the user's ``UserModulePermission``
    rows; pass it to avoid a redundant query when the caller already has them
    (e.g. ``/api/users/me/`` also needs them to compute the ``enforced`` flag).
    """
    if user is None or not getattr(user, 'pk', None):
        return {}
    if _is_admin(user):
        return {module: all_actions_for(module) for module in MODULES}

    defaults = get_role_defaults(getattr(user, 'role', None))

    custom: dict[str, list[str]] = {}
    if rows is None:
        try:
            rows = list(user.module_permissions.all())
        except Exception:
            rows = []
    for row in rows:
        if not row.is_enabled:
            custom[row.module] = []  # explicit denial
            continue
        valid = [a for a in (row.actions or []) if a in MODULE_ACTIONS.get(row.module, [])]
        custom[row.module] = valid

    effective: dict[str, list[str]] = {}
    for module in MODULES:
        if module in custom:
            actions = custom[module]
        else:
            actions = defaults.get(module, [])
        if actions:
            effective[module] = list(actions)
    return effective


def _scope_allows(scope: dict, *, project=None, organization=None) -> bool:
    """Optional per-permission scope narrowing. Empty/missing scope = allow."""
    if not isinstance(scope, dict) or not scope:
        return True
    if project is not None:
        ids = scope.get('project_ids')
        if isinstance(ids, list) and ids and int(getattr(project, 'id', project)) not in {int(i) for i in ids}:
            return False
    if organization is not None:
        ids = scope.get('organization_ids')
        if isinstance(ids, list) and ids and int(getattr(organization, 'id', organization)) not in {int(i) for i in ids}:
            return False
    return True


def user_has_module_permission(user, module: str, action: str, *, project=None, organization=None) -> bool:
    """Deny-by-default check: does ``user`` have ``action`` on ``module``?

    Admin overrides everything. Otherwise the effective permissions (custom row
    else role default) must grant the action, and any per-row scope must allow
    the given project/organization.
    """
    if _is_admin(user):
        return True
    effective = resolve_user_module_permissions(user)
    if action not in effective.get(module, []):
        return False
    # Honour scope only when a custom row carries one for this module.
    try:
        row = user.module_permissions.filter(module=module, is_enabled=True).first()
    except Exception:
        row = None
    if row is not None:
        return _scope_allows(getattr(row, 'scope', {}) or {}, project=project, organization=organization)
    return True
