from django.db import models
from django.utils import timezone


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
        ordering = ['-period_start', '-id']
        unique_together = ['indicator', 'project', 'organization', 'period_start', 'period_end']
        indexes = [
            models.Index(fields=['-period_start'], name='agg_period_start_idx'),
            # The Aggregates page and coordinator rollups scope almost every read
            # by organization + status ("approved rows for this org") and often by
            # project too. The bare FK indexes force a status filter + sort on top
            # of a wide org scan; these composites let the common browse/rollup
            # queries be served straight from an index.
            models.Index(fields=['organization', 'status'], name='agg_org_status_idx'),
            models.Index(
                fields=['project', 'organization', 'status'],
                name='agg_proj_org_status_idx',
            ),
            models.Index(fields=['status'], name='agg_status_idx'),
            models.Index(fields=['created_at'], name='agg_created_at_idx'),
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
        ordering = ['-created_at', '-score', '-id']
        indexes = [
            models.Index(fields=['scope_type', 'scope_id', '-created_at'], name='dqscore_scope_idx'),
            models.Index(fields=['mode', 'scope_type', '-created_at'], name='dqscore_mode_scope_idx'),
        ]

    def __str__(self):
        return f"DQScore[{self.scope_type}:{self.scope_id}] {self.score} ({self.label})"


class ReportingPeriod(models.Model):
    """Administrator-controlled reporting window for one project + fiscal quarter.

    This is the governance overlay for the Quarterly Reporting Control Framework.
    It does NOT replace SESIGO's eligibility architecture (project assignment +
    indicator assignment stay the source of truth) and it does NOT own any
    reporting data — aggregates keep their own natural key. A ``ReportingPeriod``
    only answers "may an assigned org submit for this quarter *right now*?".

    Backward-compatibility contract: a period is an *overlay*. When no
    ``ReportingPeriod`` row exists for a project+quarter, the write path falls
    back to the always-on quarter-completion floor (a period may only be reported
    after it has fully elapsed — see ``reporting_workbook.period_has_fully_elapsed``).
    So introducing this model never blocks an org that could already report, and
    workbooks already downloaded for a completed quarter still submit.

    ``fiscal_year`` is the Botswana fiscal *start* year (e.g. 2025 == FY 2025/26),
    matching ``reporting_workbook.quarter_period_range`` — the single fiscal
    calendar implementation. ``quarter`` is 1-4 (Q1 Apr-Jun … Q4 Jan-Mar).
    Coverage dates are derived from (quarter, fiscal_year) and kept authoritative.
    """

    STATUS_DRAFT = 'draft'
    STATUS_SCHEDULED = 'scheduled'
    STATUS_OPEN = 'open'
    STATUS_CLOSED = 'closed'
    STATUS_ARCHIVED = 'archived'
    STATUS_CHOICES = [
        (STATUS_DRAFT, 'Draft'),
        (STATUS_SCHEDULED, 'Scheduled'),
        (STATUS_OPEN, 'Open'),
        (STATUS_CLOSED, 'Closed'),
        (STATUS_ARCHIVED, 'Archived'),
    ]

    QUARTER_CHOICES = [(1, 'Q1'), (2, 'Q2'), (3, 'Q3'), (4, 'Q4')]

    project = models.ForeignKey(
        'projects.Project',
        on_delete=models.CASCADE,
        related_name='reporting_periods',
    )
    fiscal_year = models.PositiveIntegerField(
        help_text="Botswana fiscal START year, e.g. 2025 for FY 2025/26.",
    )
    quarter = models.PositiveSmallIntegerField(choices=QUARTER_CHOICES)

    # Derived from (quarter, fiscal_year); persisted so the DB can index/filter
    # on coverage without recomputing, and kept authoritative in save().
    coverage_start = models.DateField()
    coverage_end = models.DateField()

    # Administrator-controlled submission window. Nullable so a Draft can be
    # created before dates are decided; enforced when the period is opened.
    submission_opens = models.DateTimeField(null=True, blank=True)
    submission_closes = models.DateTimeField(null=True, blank=True)

    status = models.CharField(
        max_length=16, choices=STATUS_CHOICES, default=STATUS_DRAFT,
    )

    allow_late_reporting = models.BooleanField(default=False)
    late_reporting_opens = models.DateTimeField(null=True, blank=True)
    late_reporting_closes = models.DateTimeField(null=True, blank=True)

    notes = models.TextField(blank=True, default='')

    created_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_reporting_periods',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-fiscal_year', '-quarter', 'project_id', 'id']
        constraints = [
            # Exactly one reporting period per project + fiscal quarter. Because
            # the row is unique, "only one Open for the same project and quarter"
            # is guaranteed structurally, not just by status.
            models.UniqueConstraint(
                fields=['project', 'fiscal_year', 'quarter'],
                name='uniq_reporting_period_project_fy_quarter',
            ),
        ]
        indexes = [
            models.Index(fields=['project', 'status'], name='rp_project_status_idx'),
            models.Index(fields=['project', 'fiscal_year', 'quarter'], name='rp_project_fyq_idx'),
            models.Index(fields=['status'], name='rp_status_idx'),
            models.Index(fields=['fiscal_year', 'quarter'], name='rp_fyq_idx'),
            models.Index(fields=['submission_opens'], name='rp_sub_opens_idx'),
            models.Index(fields=['submission_closes'], name='rp_sub_closes_idx'),
            models.Index(fields=['coverage_start', 'coverage_end'], name='rp_coverage_idx'),
        ]

    def __str__(self):
        return f"{self.project.code} Q{self.quarter} FY{self.fiscal_year} ({self.status})"

    # ── Derived coverage (single fiscal calendar) ────────────────────────────
    def _expected_coverage(self):
        from . import reporting_workbook as rw
        return rw.quarter_period_range(self.quarter, self.fiscal_year)

    def save(self, *args, **kwargs):
        # Coverage is always authoritative from (quarter, fiscal_year) — never
        # let a caller set an inconsistent window.
        self.coverage_start, self.coverage_end = self._expected_coverage()
        super().save(*args, **kwargs)

    # ── Convenience labels (reuse the shared quarter utilities) ──────────────
    @property
    def quarter_label(self) -> str:
        from . import reporting_workbook as rw
        return rw.quarter_label(self.quarter, self.fiscal_year)

    @property
    def earliest_open_date(self):
        """First calendar day this quarter may open (day after it elapses)."""
        from . import reporting_workbook as rw
        return rw.earliest_reporting_open_date(self.coverage_end)

    @staticmethod
    def _coerce_dt(value):
        """Parse an ISO datetime string into an aware datetime; pass through
        ``None``/datetime unchanged."""
        if value in (None, ''):
            return None
        if isinstance(value, str):
            from django.utils.dateparse import parse_datetime
            parsed = parse_datetime(value)
            value = parsed if parsed is not None else value
        if hasattr(value, 'utcoffset') and value.utcoffset() is None:
            value = timezone.make_aware(value, timezone.get_current_timezone())
        return value

    def clean(self):
        """Validate an admin-configured window. The hard rule — a quarter may
        never open before it has fully elapsed — is enforced here so it cannot be
        bypassed by mis-configuring dates; the write-path service is the runtime
        guard for actual submissions."""
        from django.core.exceptions import ValidationError

        if self.quarter not in (1, 2, 3, 4):
            raise ValidationError({'quarter': 'Quarter must be 1-4.'})

        # Coerce any datetime fields still holding ISO strings (lifecycle actions
        # assign raw request values) into aware datetimes, so clean() and save()
        # both see real datetimes and comparisons never blow up on a str.
        for field in ('submission_opens', 'submission_closes',
                      'late_reporting_opens', 'late_reporting_closes'):
            setattr(self, field, self._coerce_dt(getattr(self, field)))

        # Coverage is derived from (quarter, fiscal_year). Compute it here so
        # clean() is self-sufficient even before save() has populated the fields
        # (e.g. when the serializer validates an unsaved instance).
        from . import reporting_workbook as rw
        expected_start, expected_end = self._expected_coverage()
        self.coverage_start, self.coverage_end = expected_start, expected_end
        earliest = rw.earliest_reporting_open_date(expected_end)

        opens = self.submission_opens
        closes = self.submission_closes
        if opens and closes and closes <= opens:
            raise ValidationError(
                {'submission_closes': 'Submission close must be after submission open.'}
            )

        # Quarter-completion rule: the window may not open before the quarter ends.
        if opens is not None and timezone.localdate(opens) < earliest:
            raise ValidationError({
                'submission_opens': (
                    f'Q{self.quarter} reporting cannot open before the quarter has '
                    f'fully elapsed. The earliest it may open is {earliest.isoformat()}.'
                )
            })

        if self.allow_late_reporting:
            lo, lc = self.late_reporting_opens, self.late_reporting_closes
            if lo and lc and lc <= lo:
                raise ValidationError(
                    {'late_reporting_closes': 'Late-reporting close must be after its open.'}
                )
            if lo and closes and lo < closes:
                raise ValidationError({
                    'late_reporting_opens': (
                        'Late reporting must open on or after the normal submission '
                        'deadline.'
                    )
                })
