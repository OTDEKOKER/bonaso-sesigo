from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('analysis', '0004_report_mode_savedquery_mode_scheduledreport_mode'),
    ]

    operations = [
        migrations.AddField(
            model_name='scheduledreport',
            name='last_status',
            field=models.CharField(blank=True, default='', max_length=16),
        ),
        migrations.AddField(
            model_name='scheduledreport',
            name='last_error',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='scheduledreport',
            name='consecutive_failures',
            field=models.PositiveIntegerField(default=0),
        ),
    ]
