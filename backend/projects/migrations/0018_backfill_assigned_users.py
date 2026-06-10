from django.db import migrations


def assign_all_projects_to_existing_users(apps, schema_editor):
    """Transitional backfill: assign every existing user to every existing
    project so the new project-assignment gate does not lock anyone out at
    deploy time. Admins then narrow each user's project list going forward.
    """
    Project = apps.get_model("projects", "Project")
    User = apps.get_model("users", "User")

    user_ids = list(User.objects.values_list("id", flat=True))
    if not user_ids:
        return
    for project in Project.objects.all().iterator():
        project.assigned_users.add(*user_ids)


def noop(apps, schema_editor):
    # Reverse is a no-op: we do not strip assignments on rollback.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0017_project_assigned_users"),
    ]

    operations = [
        migrations.RunPython(assign_all_projects_to_existing_users, noop),
    ]
