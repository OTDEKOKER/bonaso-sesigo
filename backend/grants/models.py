"""Grant (funding) accounting models.

A Grant is money awarded to ONE organization under ONE project. Because it
carries a ``project`` FK and an ``organization`` FK, the whole module inherits
the project + org + training scope gates used across the codebase (see
``grants.views`` — no bespoke scoping is needed).

Money is never aggregated across grants at write time: budget / disbursed /
spent totals are computed at read time (see ``grants.rollups``), mirroring the
coordinator-rollup pattern so there is a single certified source of truth.
"""
from decimal import Decimal

from django.conf import settings
from django.db import models


class Grant(models.Model):
    """A funding award to an organization under a project."""

    STATUS_CHOICES = [
        ("draft", "Draft"),
        ("active", "Active"),
        ("suspended", "Suspended"),
        ("closed", "Closed"),
    ]

    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="grants"
    )
    organization = models.ForeignKey(
        "organizations.Organization", on_delete=models.CASCADE, related_name="grants"
    )
    # Optional coordinator for hierarchy rollups (a coordinator's row sums its
    # sub-grantees' grants). Left nullable so a flat project still works.
    coordinator = models.ForeignKey(
        "organizations.Organization",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="coordinated_grants",
    )
    funder = models.ForeignKey(
        "projects.ClientOrganization",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="grants",
    )

    code = models.CharField(max_length=64, blank=True, help_text="Grant/award reference.")
    title = models.CharField(max_length=255, blank=True)
    currency = models.CharField(max_length=3, default="BWP")
    total_amount = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0.00"),
        help_text="Total amount awarded.",
    )
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="draft")
    notes = models.TextField(blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="created_grants",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["project", "organization"]),
            models.Index(fields=["coordinator"]),
        ]

    def __str__(self):
        return f"{self.code or self.title or 'Grant'} — {self.organization_id} @ {self.project_id}"


class GrantBudgetLine(models.Model):
    """A budgeted category within a grant."""

    grant = models.ForeignKey(Grant, on_delete=models.CASCADE, related_name="budget_lines")
    category = models.CharField(max_length=128)
    description = models.CharField(max_length=255, blank=True)
    budgeted_amount = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0.00")
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["category"]

    def __str__(self):
        return f"{self.category}: {self.budgeted_amount}"


class GrantDisbursement(models.Model):
    """Money paid TO the organization (a tranche)."""

    grant = models.ForeignKey(Grant, on_delete=models.CASCADE, related_name="disbursements")
    date = models.DateField()
    tranche = models.PositiveIntegerField(null=True, blank=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    reference = models.CharField(max_length=128, blank=True)
    notes = models.CharField(max_length=255, blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="created_grant_disbursements",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "-created_at"]

    def __str__(self):
        return f"Disbursement {self.amount} on {self.date}"


class GrantExpenditure(models.Model):
    """Money the organization SPENT / reported against the grant."""

    grant = models.ForeignKey(Grant, on_delete=models.CASCADE, related_name="expenditures")
    budget_line = models.ForeignKey(
        GrantBudgetLine, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="expenditures",
    )
    date = models.DateField()
    category = models.CharField(max_length=128, blank=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    description = models.CharField(max_length=255, blank=True)
    # Reuses the same upload directory convention; extension/size validation is
    # enforced at the serializer/view layer (see uploads hardening).
    supporting_document = models.FileField(
        upload_to="grants/supporting/", null=True, blank=True
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="created_grant_expenditures",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "-created_at"]

    def __str__(self):
        return f"Expenditure {self.amount} on {self.date}"
