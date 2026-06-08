from django.core.management.base import BaseCommand
from django.db import transaction
from organizations.models import Organization
from users.models import User


ORGANIZATIONS = [
    {
        "name": "Bonaso Headquarters",
        "code": "BONASO-HQ",
        "type": "headquarters",
        "description": "National headquarters",
    },
    {
        "name": "Gaborone Regional Office",
        "code": "GAB-REG",
        "type": "regional",
        "parent_code": "BONASO-HQ",
        "description": "Regional office for Greater Gaborone",
    },
    {
        "name": "Francistown Regional Office",
        "code": "FTN-REG",
        "type": "regional",
        "parent_code": "BONASO-HQ",
        "description": "Regional office for the North",
    },
    {
        "name": "Gaborone District",
        "code": "GAB-DIST",
        "type": "district",
        "parent_code": "GAB-REG",
    },
    {
        "name": "Kweneng District",
        "code": "KWE-DIST",
        "type": "district",
        "parent_code": "GAB-REG",
    },
    {
        "name": "Central District",
        "code": "CEN-DIST",
        "type": "district",
        "parent_code": "FTN-REG",
    },
    {
        "name": "BONELA",
        "code": "BONELA",
        "type": "ngo",
        "parent_code": "BONASO-HQ",
        "description": "Botswana Network on Law and Ethics",
    },
    {
        "name": "UNAIDS Botswana",
        "code": "UNAIDS-BW",
        "type": "funder",
        "description": "Joint United Nations Programme on HIV/AIDS",
    },
]

USERS = [
    {
        "username": "admin",
        "email": "admin@bonaso.local",
        "first_name": "System",
        "last_name": "Admin",
        "password": "Admin1234!",
        "role": "admin",
        "is_staff": True,
        "is_superuser": True,
    },
    {
        "username": "gab.manager",
        "email": "manager.gaborone@bonaso.local",
        "first_name": "Kabo",
        "last_name": "Moagi",
        "password": "Manager1234!",
        "role": "manager",
        "org_code": "GAB-REG",
    },
    {
        "username": "ftn.manager",
        "email": "manager.francistown@bonaso.local",
        "first_name": "Thabo",
        "last_name": "Sehularo",
        "password": "Manager1234!",
        "role": "manager",
        "org_code": "FTN-REG",
    },
    {
        "username": "gab.officer",
        "email": "officer.gaborone@bonaso.local",
        "first_name": "Mpho",
        "last_name": "Dithebe",
        "password": "Officer1234!",
        "role": "officer",
        "org_code": "GAB-DIST",
    },
    {
        "username": "kwe.officer",
        "email": "officer.kweneng@bonaso.local",
        "first_name": "Boitumelo",
        "last_name": "Letshwiti",
        "password": "Officer1234!",
        "role": "officer",
        "org_code": "KWE-DIST",
    },
    {
        "username": "gab.collector",
        "email": "collector.gaborone@bonaso.local",
        "first_name": "Neo",
        "last_name": "Gaolatlhe",
        "password": "Collector1234!",
        "role": "collector",
        "org_code": "GAB-DIST",
    },
    {
        "username": "bonela.collector",
        "email": "collector.bonela@bonaso.local",
        "first_name": "Lorato",
        "last_name": "Kepadisa",
        "password": "Collector1234!",
        "role": "collector",
        "org_code": "BONELA",
    },
    {
        "username": "unaids.client",
        "email": "client.unaids@bonaso.local",
        "first_name": "Sarah",
        "last_name": "Oduya",
        "password": "Client1234!",
        "role": "client",
        "org_code": "UNAIDS-BW",
    },
]


class Command(BaseCommand):
    help = "Seed initial organizations and users"

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete all existing users (except superusers) and organizations before seeding",
        )

    def handle(self, *args, **options):
        if options["reset"]:
            self.stdout.write(self.style.WARNING("Resetting existing data..."))
            User.objects.filter(is_superuser=False).delete()
            Organization.objects.all().delete()

        with transaction.atomic():
            orgs = self._seed_organizations()
            self._seed_users(orgs)

        self.stdout.write(self.style.SUCCESS("\nDone. Login credentials:"))
        self.stdout.write("  admin          / Admin1234!")
        self.stdout.write("  gab.manager    / Manager1234!")
        self.stdout.write("  ftn.manager    / Manager1234!")
        self.stdout.write("  gab.officer    / Officer1234!")
        self.stdout.write("  kwe.officer    / Officer1234!")
        self.stdout.write("  gab.collector  / Collector1234!")
        self.stdout.write("  bonela.collector / Collector1234!")
        self.stdout.write("  unaids.client  / Client1234!")

    def _seed_organizations(self):
        orgs = {}
        for data in ORGANIZATIONS:
            parent_code = data.pop("parent_code", None)
            parent = orgs.get(parent_code)
            org, created = Organization.objects.update_or_create(
                code=data["code"],
                defaults={**data, "parent": parent},
            )
            orgs[org.code] = org
            status = "created" if created else "updated"
            self.stdout.write(f"  org {status}: {org.name} ({org.code})")
        return orgs

    def _seed_users(self, orgs):
        for data in USERS:
            org_code = data.pop("org_code", None)
            password = data.pop("password")
            org = orgs.get(org_code) if org_code else None

            user, created = User.objects.update_or_create(
                username=data["username"],
                defaults={**data, "organization": org},
            )
            if created:
                user.set_password(password)
                user.save(update_fields=["password"])
            status = "created" if created else "already exists"
            self.stdout.write(f"  user {status}: {user.username} ({user.role})")
