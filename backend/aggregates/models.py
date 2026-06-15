from django.db import models


class Aggregate(models.Model):
    """Aggregate data entry without respondent linking."""

    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('pending', 'Pending'),
        ('reviewed', 'Reviewed'),
        ('flagged', 'Flagged'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    ]
    
    indicator = models.ForeignKey(
        'indicators.Indicator',
        on_delete=models.CASCADE,
        related_name='aggregates'
    )
    project = models.ForeignKey(
        'projects.Project',
        on_delete=models.CASCADE,
        related_name='aggregates'
    )
    organization = models.ForeignKey(
        'organizations.Organization',
        on_delete=models.CASCADE,
        related_name='aggregates'
    )
    
    period_start = models.DateField()
    period_end = models.DateField()
    
    # Store value as JSON to handle different types
    value = models.JSONField()

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reviewed_aggregates',
    )

    notes = models.TextField(blank=True)
    copy_paste_verified = models.BooleanField(
        default=False,
        help_text="Set by admin after confirming that identical values across indicators are genuinely correct. Skips future copy-paste detection for this record.",
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_aggregates'
    )
    
    class Meta:
        ordering = ['-period_start']
        unique_together = ['indicator', 'project', 'organization', 'period_start', 'period_end']
        indexes = [
            models.Index(fields=['-period_start'], name='agg_period_start_idx'),
        ]
    
    def __str__(self):
        return f"{self.indicator.code} - {self.organization.name} ({self.period_start})"


class AggregateFact(models.Model):
    """Flattened, query-optimised projection of one Aggregate's ``value``.

    Each ``Aggregate.value`` (free-form JSON) is exploded into one row per
    numeric disaggregate leaf — ``(primary, secondary, band, value)`` — so
    rollups become a pure SQL ``GROUP BY`` with indexes instead of pulling every
    row to the client and summing in JavaScript.

    Invariant: the fact rows for an aggregate sum to that aggregate's
    disaggregated total (disaggregates preferred, else male/female, else the
    scalar total) — never both, so leaves never double-count.

    This table is *derived* and fully rebuildable from ``Aggregate`` (see
    ``aggregates.facts.sync_facts_for_aggregate`` + the post_save/delete signals
    and the ``backfill_aggregate_facts`` command). It is safe to truncate and
    rebuild. Columns are denormalised so rollup queries need no joins and can
    reuse the same project/org scope filters as the main viewset.
    """

    TOTAL_BAND = "Total"
    ALL = "All"

    aggregate = models.ForeignKey(
        Aggregate, on_delete=models.CASCADE, related_name="facts"
    )
    # Denormalised dimensions (no joins needed at rollup time).
    indicator = models.ForeignKey(
        'indicators.Indicator', on_delete=models.CASCADE, related_name='+'
    )
    # Alias-safe rollup key: the canonical indicator (self when not a duplicate).
    canonical_indicator = models.ForeignKey(
        'indicators.Indicator', on_delete=models.CASCADE, related_name='+'
    )
    project = models.ForeignKey(
        'projects.Project', on_delete=models.CASCADE, related_name='+'
    )
    organization = models.ForeignKey(
        'organizations.Organization', on_delete=models.CASCADE, related_name='+'
    )
    period_start = models.DateField()
    period_end = models.DateField()
    status = models.CharField(max_length=20, db_index=True)
    is_training = models.BooleanField(default=False)

    # Generous lengths: disaggregate labels can be long free-text (e.g. full
    # message/category names). Not indexed individually, so width is cheap.
    primary = models.CharField(max_length=512, default=ALL)     # key population / category
    secondary = models.CharField(max_length=255, default=ALL)   # sex / second dimension
    band = models.CharField(max_length=255, default=TOTAL_BAND)  # raw age band
    value = models.DecimalField(max_digits=20, decimal_places=4, default=0)

    class Meta:
        indexes = [
            models.Index(fields=['canonical_indicator', 'status', 'is_training'], name='aggfact_ind_status_idx'),
            models.Index(fields=['project', 'organization', 'period_start'], name='aggfact_scope_period_idx'),
            models.Index(fields=['status', 'is_training', 'period_start'], name='aggfact_status_period_idx'),
        ]

    def __str__(self):
        return f"fact[{self.aggregate_id}] {self.primary}/{self.secondary}/{self.band}={self.value}"
