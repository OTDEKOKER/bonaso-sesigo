from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("uploads", "0003_importjob_background_fields"),
        ("users", "0003_user_home_dashboard_preferences"),
    ]

    operations = [
        migrations.CreateModel(
            name="ExportJob",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("job_type", models.CharField(default="aggregate_export", max_length=50)),
                ("status", models.CharField(choices=[("pending", "Pending"), ("processing", "Processing"), ("completed", "Completed"), ("failed", "Failed")], default="pending", max_length=20)),
                ("parameters", models.JSONField(blank=True, default=dict)),
                ("result", models.JSONField(blank=True, default=dict)),
                ("output_file", models.CharField(blank=True, max_length=500)),
                ("file_name", models.CharField(blank=True, max_length=255)),
                ("content_type", models.CharField(blank=True, max_length=150)),
                ("errors", models.JSONField(blank=True, default=list)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="export_jobs", to="users.user")),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
    ]
