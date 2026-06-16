"""Weekly admin reminder to download the database backup off-server.

Intended to run every Monday morning via cron. If the most recent
``backup_downloaded`` audit event is older than 7 days (or none exists), it
emails every admin/superuser with an address and records a
``backup_download_reminder_sent`` audit event so the reminder itself is provable.

Data-protection note: this sends a *reminder to download*, never the backup
file. The dump contains sensitive respondent data and must not be emailed.

Cron (Mondays 07:00):
    0 7 * * 1 cd /home/bonasoadmin/BONASOV1/backend && \
      ./venv/bin/python manage.py send_backup_download_reminder \
      >> backups/database/reminder.log 2>&1
"""
from django.core.mail import send_mail
from django.core.management.base import BaseCommand

from audit.recording import record_audit_event
from core.backup_views import DOWNLOAD_DUE_DAYS, _download_state
from users.models import User


class Command(BaseCommand):
    help = "Email admins to download the latest backup if none downloaded in 7 days."

    def add_arguments(self, parser):
        parser.add_argument("--force", action="store_true",
                            help="Send even if a recent download exists.")
        parser.add_argument("--dry-run", action="store_true",
                            help="Report what would happen without sending or recording.")

    def handle(self, *args, **options):
        last, days, level, due, _actor = _download_state()
        if not due and not options["force"]:
            self.stdout.write(
                f"Backup downloaded {days} day(s) ago (< {DOWNLOAD_DUE_DAYS}); no reminder needed."
            )
            return

        recipients = list(
            User.objects.filter(is_active=True)
            .filter(role="admin")
            .exclude(email="")
            .values_list("email", flat=True)
        )
        # Include superusers/staff even if role differs.
        recipients += list(
            User.objects.filter(is_active=True)
            .filter(is_superuser=True)
            .exclude(email="")
            .values_list("email", flat=True)
        )
        recipients = sorted(set(e for e in recipients if e))

        when = "never" if days is None else f"{days} day(s) ago"
        subject = "Weekly backup download is due"
        body = (
            "Weekly backup download is due. Download the latest backup now.\n\n"
            f"Last download: {when}.\n\n"
            "Open the System Status page in the SESIGO portal and use "
            "'Download latest backup'. Store it on an encrypted external drive.\n\n"
            "This reminder does not contain the backup itself for data-protection "
            "reasons; the dump holds sensitive respondent data."
        )

        if options["dry_run"]:
            self.stdout.write(
                f"[dry-run] would email {len(recipients)} admin(s): {recipients}"
            )
            return

        if not recipients:
            self.stderr.write(
                "No admin recipients with an email address; reminder not sent."
            )
            return

        sent = 0
        try:
            sent = send_mail(
                subject, body, None, recipients, fail_silently=False
            )
        except Exception as exc:  # SMTP not configured, network, etc.
            self.stderr.write(f"Reminder email failed to send: {exc}")
            return

        record_audit_event(
            action="backup_download_reminder_sent",
            object_type="backup",
            description=f"Weekly backup download reminder sent to {len(recipients)} admin(s).",
            metadata={"recipients": recipients, "days_since_download": days},
        )
        self.stdout.write(f"Reminder sent to {len(recipients)} admin(s) ({sent} message(s)).")
