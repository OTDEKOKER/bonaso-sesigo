from django.db import migrations, models


class Migration(migrations.Migration):
    """Differentiate districts from localities on ProjectOrganization.

    The combined `districts_localities` column is renamed to `districts`
    (preserving existing data) and a separate `localities` column is added.
    Data is then re-split from source sheets by a follow-up script.
    """

    dependencies = [
        ('projects', '0015_project_assignment_fields_and_indicator_link'),
    ]

    operations = [
        migrations.RenameField(
            model_name='projectorganization',
            old_name='districts_localities',
            new_name='districts',
        ),
        migrations.AddField(
            model_name='projectorganization',
            name='localities',
            field=models.JSONField(blank=True, default=list),
        ),
    ]
