from django.db import migrations, models


class Migration(migrations.Migration):
    """Add composite/status/created_at indexes matching the dominant read paths.

    The Aggregates browse page and coordinator rollups scope reads by
    organization + status (and often project). The pre-existing single-column FK
    indexes left the DB filtering status and sorting on top of a wide org scan.
    These indexes are additive only (no data change) and build in well under a
    second on the current ~16k-row table.
    """

    dependencies = [
        ("aggregates", "0007_dataqualityscore"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="aggregate",
            index=models.Index(
                fields=["organization", "status"], name="agg_org_status_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="aggregate",
            index=models.Index(
                fields=["project", "organization", "status"],
                name="agg_proj_org_status_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="aggregate",
            index=models.Index(fields=["status"], name="agg_status_idx"),
        ),
        migrations.AddIndex(
            model_name="aggregate",
            index=models.Index(fields=["created_at"], name="agg_created_at_idx"),
        ),
    ]
