from django.db import migrations


def _bulk_create_ignore_conflicts(model, rows, batch_size=2000):
    if not rows:
        return
    for start in range(0, len(rows), batch_size):
        model.objects.bulk_create(
            rows[start:start + batch_size],
            batch_size=batch_size,
            ignore_conflicts=True,
        )


def backfill_project_indicator_assignments(apps, schema_editor):
    Project = apps.get_model('projects', 'Project')
    ProjectIndicator = apps.get_model('projects', 'ProjectIndicator')
    ProjectOrganization = apps.get_model('projects', 'ProjectOrganization')
    ProjectIndicatorOrganizationTarget = apps.get_model('projects', 'ProjectIndicatorOrganizationTarget')
    ProjectIndicatorAssignment = apps.get_model('projects', 'ProjectIndicatorAssignment')
    Aggregate = apps.get_model('aggregates', 'Aggregate')

    project_org_ids = {}

    for project_id, organization_id in ProjectOrganization.objects.filter(
        is_active=True
    ).values_list('project_id', 'organization_id'):
        project_org_ids.setdefault(project_id, set()).add(organization_id)

    through_model = Project.organizations.through
    for project_id, organization_id in through_model.objects.values_list('project_id', 'organization_id'):
        project_org_ids.setdefault(project_id, set()).add(organization_id)

    project_indicator_ids_by_project = {}
    project_indicator_id_by_key = {}
    for project_indicator_id, project_id, indicator_id in ProjectIndicator.objects.values_list(
        'id',
        'project_id',
        'indicator_id',
    ):
        project_indicator_ids_by_project.setdefault(project_id, []).append(project_indicator_id)
        project_indicator_id_by_key[(project_id, indicator_id)] = project_indicator_id

    existing_keys = set(
        ProjectIndicatorAssignment.objects.values_list(
            'project_indicator_id',
            'organization_id',
        )
    )
    project_indicator_ids_with_assignments = {project_indicator_id for project_indicator_id, _ in existing_keys}

    pending_rows = []

    # 1) Explicit indicator-organization target rows are authoritative.
    for project_indicator_id, organization_id in ProjectIndicatorOrganizationTarget.objects.values_list(
        'project_indicator_id',
        'organization_id',
    ).iterator():
        key = (project_indicator_id, organization_id)
        if key in existing_keys:
            project_indicator_ids_with_assignments.add(project_indicator_id)
            continue
        pending_rows.append(
            ProjectIndicatorAssignment(
                project_indicator_id=project_indicator_id,
                organization_id=organization_id,
                assignment_source='organization_target',
                is_active=True,
            )
        )
        existing_keys.add(key)
        project_indicator_ids_with_assignments.add(project_indicator_id)

    # 2) Historical aggregate submissions imply indicator assignment scope.
    for project_id, indicator_id, organization_id in Aggregate.objects.values_list(
        'project_id',
        'indicator_id',
        'organization_id',
    ).distinct().iterator():
        project_indicator_id = project_indicator_id_by_key.get((project_id, indicator_id))
        if project_indicator_id is None:
            continue
        key = (project_indicator_id, organization_id)
        if key in existing_keys:
            project_indicator_ids_with_assignments.add(project_indicator_id)
            continue
        pending_rows.append(
            ProjectIndicatorAssignment(
                project_indicator_id=project_indicator_id,
                organization_id=organization_id,
                assignment_source='aggregate_history',
                is_active=True,
            )
        )
        existing_keys.add(key)
        project_indicator_ids_with_assignments.add(project_indicator_id)

    # 3) Compatibility fallback: when no assignment exists yet for a project
    # indicator, map it to all organizations in project scope.
    for project_id, project_indicator_ids in project_indicator_ids_by_project.items():
        organization_ids = project_org_ids.get(project_id, set())
        if not organization_ids:
            continue
        for project_indicator_id in project_indicator_ids:
            if project_indicator_id in project_indicator_ids_with_assignments:
                continue
            for organization_id in organization_ids:
                key = (project_indicator_id, organization_id)
                if key in existing_keys:
                    continue
                pending_rows.append(
                    ProjectIndicatorAssignment(
                        project_indicator_id=project_indicator_id,
                        organization_id=organization_id,
                        assignment_source='project_scope',
                        is_active=True,
                    )
                )
                existing_keys.add(key)
            project_indicator_ids_with_assignments.add(project_indicator_id)

    _bulk_create_ignore_conflicts(ProjectIndicatorAssignment, pending_rows)


def noop_reverse(apps, schema_editor):
    # Additive compatibility backfill only.
    return


class Migration(migrations.Migration):

    dependencies = [
        ('aggregates', '0003_aggregate_review_fields'),
        ('projects', '0007_projectindicatordisaggregationrule_and_more'),
    ]

    operations = [
        migrations.RunPython(backfill_project_indicator_assignments, reverse_code=noop_reverse),
    ]
