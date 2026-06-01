from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0012_projectindicator_target_group'),
    ]

    operations = [
        migrations.AddField(
            model_name='project',
            name='is_training',
            field=models.BooleanField(
                default=False,
                help_text=(
                    "Training projects are used for practical exercises. Their data is "
                    "excluded from official dashboards and reports by default and may be "
                    "automatically cleared after 7 days."
                ),
            ),
        ),
        migrations.AddField(
            model_name='project',
            name='training_expires_after_days',
            field=models.PositiveIntegerField(
                default=7,
                help_text="Number of days after which training data is eligible for automatic cleanup.",
            ),
        ),
        migrations.AddField(
            model_name='project',
            name='training_notes',
            field=models.TextField(
                blank=True,
                default='',
                help_text="Internal notes about this training project or session.",
            ),
        ),
    ]
