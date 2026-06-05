from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("uploads", "0002_alter_importjob_status"),
    ]

    operations = [
        migrations.AddField(
            model_name="importjob",
            name="job_type",
            field=models.CharField(default="upload_import", max_length=50),
        ),
        migrations.AddField(
            model_name="importjob",
            name="parameters",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="importjob",
            name="result",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="importjob",
            name="output_file",
            field=models.CharField(blank=True, max_length=500),
        ),
    ]
