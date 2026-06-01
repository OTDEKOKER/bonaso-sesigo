from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='project',
            name='hierarchy_overrides',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
