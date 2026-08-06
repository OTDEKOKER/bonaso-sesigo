# Data migration: give every existing user a fresh password-expiry clock at the
# moment this deploys, so enabling PASSWORD_EXPIRY_DAYS does not lock out the
# whole user base on day one. New/changed passwords stamp password_changed_at
# via users.User.set_password from here on. See settings.PASSWORD_EXPIRY_DAYS.
from django.db import migrations
from django.utils import timezone


def backfill_password_changed_at(apps, schema_editor):
    User = apps.get_model('users', 'User')
    User.objects.filter(password_changed_at__isnull=True).update(
        password_changed_at=timezone.now()
    )


def noop_reverse(apps, schema_editor):
    # Intentionally irreversible in data terms: we do not blank the timestamps
    # back out, since that would re-expire everyone. Safe no-op on reverse.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0008_password_expiry_and_reset_requests'),
    ]

    operations = [
        migrations.RunPython(backfill_password_changed_at, noop_reverse),
    ]
