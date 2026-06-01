from django.db import migrations


def _coerce_positive_int(value):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _normalize_overrides(raw_overrides, allowed_org_ids):
    if not isinstance(raw_overrides, dict):
        return {}

    normalized = {}
    allowed_set = {int(org_id) for org_id in allowed_org_ids}

    for raw_parent_id, raw_children in raw_overrides.items():
        parent_id = _coerce_positive_int(raw_parent_id)
        if parent_id is None or parent_id not in allowed_set:
            continue

        if isinstance(raw_children, (list, tuple, set)):
            children_iterable = raw_children
        else:
            children_iterable = []

        children = []
        seen = set()
        for raw_child_id in children_iterable:
            child_id = _coerce_positive_int(raw_child_id)
            if child_id is None:
                continue
            if child_id not in allowed_set or child_id == parent_id or child_id in seen:
                continue
            seen.add(child_id)
            children.append(child_id)

        normalized[parent_id] = children

    return normalized


def backfill_project_scope_tables(apps, schema_editor):
    Project = apps.get_model('projects', 'Project')
    ProjectOrganization = apps.get_model('projects', 'ProjectOrganization')
    ProjectOrganizationHierarchy = apps.get_model('projects', 'ProjectOrganizationHierarchy')

    through_model = Project.organizations.through

    project_org_map = {}
    for project_id, organization_id in through_model.objects.values_list('project_id', 'organization_id'):
        project_org_map.setdefault(project_id, set()).add(organization_id)

    for project in Project.objects.all().only('id', 'hierarchy_overrides').iterator():
        project_org_ids = project_org_map.get(project.id, set())

        for organization_id in project_org_ids:
            ProjectOrganization.objects.update_or_create(
                project_id=project.id,
                organization_id=organization_id,
                defaults={'is_active': True},
            )

        normalized_overrides = _normalize_overrides(
            getattr(project, 'hierarchy_overrides', {}) or {},
            project_org_ids,
        )

        for parent_organization_id, child_ids in normalized_overrides.items():
            for child_organization_id in child_ids:
                ProjectOrganizationHierarchy.objects.update_or_create(
                    project_id=project.id,
                    parent_organization_id=parent_organization_id,
                    child_organization_id=child_organization_id,
                    defaults={'is_active': True},
                )


def noop_reverse(apps, schema_editor):
    # Data backfill is intentionally non-destructive and does not need reversal.
    return


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0005_projectorganizationhierarchy_projectorganization_and_more'),
    ]

    operations = [
        migrations.RunPython(backfill_project_scope_tables, reverse_code=noop_reverse),
    ]
