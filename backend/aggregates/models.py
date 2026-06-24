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


class DataQualityScore(models.Model):
    """A point-in-time data-quality score snapshot for a scope.

    The Data Quality monitoring run writes one row per scored scope
    (organization / coordinator / project / national) so the dashboard can show
    rankings and the trend over time. Per-aggregate quality is not snapshotted
    here (it is computed on demand + surfaced as Flags); this table powers the
    historical/trend + ranking views.
    """

    SCOPE_CHOICES = [
        ('organization', 'Organization'),
        ('coordinator', 'Coordinator'),
        ('project', 'Project'),
        ('national', 'National'),
    ]
    MODE_CHOICES = [('live', 'Live'), ('training', 'Training')]

    scope_type = models.CharField(max_length=16, choices=SCOPE_CHOICES)
    # The organization/coordinator/project id the score is for (null for national).
    scope_id = models.IntegerField(null=True, blank=True)
    scope_label = models.CharField(max_length=255, blank=True, default='')
    project = models.ForeignKey(
        'projects.Project', on_delete=models.CASCADE, null=True, blank=True,
        related_name='data_quality_scores',
    )
    mode = models.CharField(max_length=10, choices=MODE_CHOICES, default='live')

    # The reporting window the score covers (null = all-time / current).
    period_start = models.DateField(null=True, blank=True)
    period_end = models.DateField(null=True, blank=True)

    score = models.DecimalField(max_digits=5, decimal_places=1, default=0)
    label = models.CharField(max_length=32, blank=True, default='')
    factors = models.JSONField(default=dict, blank=True)   # per-factor 0-100 scores
    details = models.JSONField(default=dict, blank=True)   # counts feeding the score

    # Groups all rows written by a single monitoring run (e.g. "2026-06-23-daily").
    run_label = models.CharField(max_length=64, blank=True, default='', db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at', '-score']
        indexes = [
            models.Index(fields=['scope_type', 'scope_id', '-created_at'], name='dqscore_scope_idx'),
            models.Index(fields=['mode', 'scope_type', '-created_at'], name='dqscore_mode_scope_idx'),
        ]

    def __str__(self):
        return f"DQScore[{self.scope_type}:{self.scope_id}] {self.score} ({self.label})"
