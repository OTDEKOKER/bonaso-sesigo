from django.db import migrations, models


def backfill_project_assignment_fields(apps, schema_editor):
    Project = apps.get_model('projects', 'Project')
    ProjectIndicator = apps.get_model('projects', 'ProjectIndicator')
    ProjectIndicatorAssignment = apps.get_model('projects', 'ProjectIndicatorAssignment')
    ProjectOrganization = apps.get_model('projects', 'ProjectOrganization')
    ProjectOrganizationHierarchy = apps.get_model('projects', 'ProjectOrganizationHierarchy')
    ClientOrganization = apps.get_model('projects', 'ClientOrganization')

    project_is_training = {
        int(project_id): bool(is_training)
        for project_id, is_training in Project.objects.values_list('id', 'is_training')
    }

    through_model = ClientOrganization.projects.through
    first_client_by_project_id = {}
    for project_id, client_id in through_model.objects.values_list('project_id', 'clientorganization_id'):
        project_id = int(project_id)
        if project_id not in first_client_by_project_id:
            first_client_by_project_id[project_id] = int(client_id)

    membership_lookup = {}
    for membership in ProjectOrganization.objects.all().iterator():
        updates = []
        project_id = int(membership.project_id)
        role_value = str(membership.role or '').strip()

        if not membership.client_id and project_id in first_client_by_project_id:
            membership.client_id = first_client_by_project_id[project_id]
            updates.append('client')

        if role_value == 'coordinator' and not membership.is_coordinator:
            membership.is_coordinator = True
            updates.append('is_coordinator')

        if role_value == 'sub_grantee' and not membership.is_sub_grantee:
            membership.is_sub_grantee = True
            updates.append('is_sub_grantee')

        if role_value in {'coordinator', 'sub_grantee', 'implementing_partner'} and not membership.is_implementer:
            membership.is_implementer = True
            updates.append('is_implementer')

        if not membership.can_report_indicators:
            membership.can_report_indicators = True
            updates.append('can_report_indicators')

        project_is_training_value = project_is_training.get(project_id, False)
        if membership.is_training != project_is_training_value:
            membership.is_training = project_is_training_value
            updates.append('is_training')

        if updates:
            membership.save(update_fields=list(dict.fromkeys(updates + ['updated_at'])))

        membership_lookup[(project_id, int(membership.organization_id))] = membership.id

    child_assignment_parent = {}
    for link in ProjectOrganizationHierarchy.objects.filter(is_active=True).order_by('id').iterator():
        project_id = int(link.project_id)
        parent_key = (project_id, int(link.parent_organization_id))
        child_key = (project_id, int(link.child_organization_id))
        parent_assignment_id = membership_lookup.get(parent_key)
        child_assignment_id = membership_lookup.get(child_key)
        if not parent_assignment_id or not child_assignment_id:
            continue
        if child_assignment_id in child_assignment_parent:
            continue
        child_assignment_parent[child_assignment_id] = parent_assignment_id

    for child_assignment_id, parent_assignment_id in child_assignment_parent.items():
        ProjectOrganization.objects.filter(id=child_assignment_id).update(
            parent_assignment_id=parent_assignment_id,
            is_sub_grantee=True,
        )
        ProjectOrganization.objects.filter(id=parent_assignment_id).update(
            is_coordinator=True,
        )

    project_indicator_project_lookup = {
        int(project_indicator_id): int(project_id)
        for project_indicator_id, project_id in ProjectIndicator.objects.values_list('id', 'project_id')
    }

    for row in ProjectIndicatorAssignment.objects.all().iterator():
        project_id = project_indicator_project_lookup.get(int(row.project_indicator_id))
        if not project_id:
            continue
        assignment_id = membership_lookup.get((project_id, int(row.organization_id)))
        if not assignment_id:
            continue
        if row.project_organization_id != assignment_id:
            row.project_organization_id = assignment_id
            row.save(update_fields=['project_organization', 'updated_at'])


def noop_reverse(apps, schema_editor):
    return


class Migration(migrations.Migration):

    # Run each operation in its own transaction. Several ADD COLUMN ... DEFAULT
    # NOT NULL statements rewrite the table, and FK columns create indexes; doing
    # all of that plus the data backfill in one transaction triggers Postgres
    # "cannot CREATE INDEX ... pending trigger events". Non-atomic avoids it.
    atomic = False

    dependencies = [
        ('projects', '0014_alter_projectindicator_target_group'),
    ]

    operations = [
        migrations.AddField(
            model_name='projectindicatorassignment',
            name='project_organization',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.deletion.CASCADE,
                related_name='project_indicator_assignments',
                to='projects.projectorganization',
            ),
        ),
        migrations.AddField(
            model_name='projectorganization',
            name='can_report_indicators',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='projectorganization',
            name='client',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.deletion.SET_NULL,
                related_name='project_assignments',
                to='projects.clientorganization',
            ),
        ),
        migrations.AddField(
            model_name='projectorganization',
            name='cluster',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AddField(
            model_name='projectorganization',
            name='contract_end_date',
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='projectorganization',
            name='contract_start_date',
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='projectorganization',
            name='districts_localities',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name='projectorganization',
            name='is_coordinator',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='projectorganization',
            name='is_implementer',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='projectorganization',
            name='is_sub_grantee',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='projectorganization',
            name='is_training',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='projectorganization',
            name='parent_assignment',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.deletion.SET_NULL,
                related_name='child_assignments',
                to='projects.projectorganization',
            ),
        ),
        migrations.AddField(
            model_name='projectorganization',
            name='source_row',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='projectorganization',
            name='source_sheet',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AddField(
            model_name='projectorganization',
            name='thematic_areas',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunPython(backfill_project_assignment_fields, reverse_code=noop_reverse),
    ]
