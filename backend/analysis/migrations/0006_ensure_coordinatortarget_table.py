"""Ensure the unmanaged ``analysis_coordinatortarget`` table exists.

``CoordinatorTarget`` is ``managed = False`` (migration 0003 records state only),
so Django never creates its table. In production the table is a long-lived,
pre-existing table — but in a FRESH database (the test database, or a brand-new
environment) it is absent, which forced test code to create it at runtime via
``schema_editor.create_model`` inside ``setUpClass``. That runtime ``CREATE TABLE``
auto-commits in SQLite, which committed the class's ``setUpTestData`` rows and
leaked them (users/orgs/indicators) into the rest of the suite, causing spurious
UNIQUE-constraint and global-count failures in unrelated apps.

Creating the table here — guarded by an existence check — makes it present before
any test data is created (no leak), and is a strict no-op in production where the
table already exists.
"""
from django.db import migrations


def ensure_table(apps, schema_editor):
    # Use the REAL model (not the historical one): migration 0003 recorded only
    # the scalar fields for this managed=False model, so the historical state is
    # missing the project/coordinator/indicator FK columns. The concrete model
    # has the full field set — this mirrors exactly what the test mixin does with
    # ``schema_editor.create_model(CoordinatorTarget)`` at runtime. SQLite creates
    # the FK columns even if the target tables don't exist yet, and in production
    # the whole block is skipped because the table already exists.
    from analysis.models import CoordinatorTarget
    table = CoordinatorTarget._meta.db_table
    if table not in schema_editor.connection.introspection.table_names():
        schema_editor.create_model(CoordinatorTarget)


def noop(apps, schema_editor):
    # Never drop a long-lived production table on reverse.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('analysis', '0005_scheduledreport_run_state'),
    ]

    operations = [
        migrations.RunPython(ensure_table, noop),
    ]
