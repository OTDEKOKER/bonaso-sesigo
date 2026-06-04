import re

from django.db import models


class Indicator(models.Model):
    """Indicator model for tracking metrics."""
    
    TYPE_CHOICES = [
        ('yes_no', 'Yes/No'),
        ('number', 'Number'),
        ('percentage', 'Percentage'),
        ('text', 'Text'),
        ('select', 'Single Select'),
        ('multiselect', 'Multi Select'),
        ('date', 'Date'),
        ('multi_int', 'Multiple Integers'),
    ]
    
    CATEGORY_CHOICES = [
        ('hiv_prevention', 'HIV Prevention'),
        ('ncd', 'Non-Communicable Diseases'),
        ('mental_health', 'Mental Health'),
        ('gbv', 'GBV'),
        ('sti', 'STI'),
        ('trainings', 'Trainings'),
        ('media', 'Media'),
        ('events', 'Events'),
    ]
    
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=50, unique=True)
    description = models.TextField(blank=True)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='number')
    category = models.CharField(max_length=30, choices=CATEGORY_CHOICES, default='hiv_prevention')
    unit = models.CharField(max_length=50, blank=True, help_text='e.g., people, sessions, %')
    
    # For select/multiselect types
    options = models.JSONField(default=list, blank=True, help_text='Options for select types')
    
    # For multi_int type
    sub_labels = models.JSONField(default=list, blank=True, help_text='Labels for multi-int fields')

    # Aggregate disaggregation matrix config (dimensions/values used when
    # entering aggregate data). Empty dict means no disaggregation.
    aggregate_disaggregation_config = models.JSONField(default=dict, blank=True)

    # Aggregation and calculation
    aggregation_method = models.CharField(
        max_length=20,
        choices=[('sum', 'Sum'), ('average', 'Average'), ('count', 'Count'), ('latest', 'Latest')],
        default='sum'
    )
    
    # Visibility and access
    is_active = models.BooleanField(default=True)

    # Deduplication — a non-null canonical_indicator means this indicator is a
    # deprecated duplicate. Historical data stays on this row; new assignments
    # should use the canonical. is_deprecated is always True when canonical is set.
    canonical_indicator = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='deprecated_variants',
        help_text='Points to the canonical indicator this one was merged into.',
    )
    is_deprecated = models.BooleanField(
        default=False,
        help_text='Deprecated indicators are hidden from new assignments but preserved for history.',
    )

    organizations = models.ManyToManyField(
        'organizations.Organization',
        blank=True,
        related_name='indicators'
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_indicators'
    )
    
    class Meta:
        ordering = ['category', 'name']
    
    def __str__(self):
        return f"{self.code} - {self.name}"


class IndicatorAlias(models.Model):
    """Alternate import/display names that resolve to a canonical indicator."""

    indicator = models.ForeignKey(
        Indicator,
        on_delete=models.CASCADE,
        related_name='aliases',
    )
    name = models.CharField(max_length=255)
    normalized_name = models.CharField(max_length=255, editable=False, db_index=True)
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_indicator_aliases',
    )

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(
                fields=['indicator', 'normalized_name'],
                name='unique_indicator_alias_per_indicator',
            ),
            models.UniqueConstraint(
                fields=['normalized_name'],
                condition=models.Q(is_active=True),
                name='unique_active_indicator_alias_name',
            ),
        ]

    def save(self, *args, **kwargs):
        self.normalized_name = re.sub(
            r"\s+",
            " ",
            re.sub(r"[^a-z0-9]+", " ", str(self.name or "").lower()),
        ).strip()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.name} -> {self.indicator.name}"


AGGREGATE_MODE_CHOICES = [
    ('none', 'No automatic roll-up'),
    ('count_all', 'Count each answered response'),
    ('count_selected', 'Count selected values'),
    ('sum_numeric', 'Use numeric answer total'),
]


class Question(models.Model):
    """A reusable data-collection question.

    Questions live in their own bank, independent of indicators. A question
    *optionally* links to an Indicator, and only then does its answer roll up
    into that indicator's reporting total. Forms (Assessments) are assembled
    from questions via ``AssessmentQuestion``.
    """

    text = models.CharField(max_length=255, help_text='Question prompt shown to the data collector')
    code = models.CharField(
        max_length=50,
        unique=True,
        blank=True,
        help_text='Optional stable code used for seeding/import references',
    )
    help_text = models.TextField(blank=True, help_text='Optional helper text shown below the question')

    response_type = models.CharField(
        max_length=20,
        choices=Indicator.TYPE_CHOICES,
        default='text',
    )
    options = models.JSONField(
        default=list,
        blank=True,
        help_text='Options for select / multiselect questions',
    )
    sub_labels = models.JSONField(
        default=list,
        blank=True,
        help_text='Labels for multi-integer questions',
    )
    category = models.CharField(
        max_length=30,
        choices=Indicator.CATEGORY_CHOICES,
        blank=True,
        default='',
    )

    # Optional reporting link — answers only roll up when this is set.
    indicator = models.ForeignKey(
        Indicator,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='questions',
        help_text='Optional indicator this question contributes to for reporting',
    )
    aggregate_mode = models.CharField(
        max_length=20,
        choices=AGGREGATE_MODE_CHOICES,
        default='none',
        help_text='How this question contributes to the linked indicator total',
    )
    aggregate_match_values = models.JSONField(
        default=list,
        blank=True,
        help_text='Values that count when aggregate mode uses selected values',
    )

    organizations = models.ManyToManyField(
        'organizations.Organization',
        blank=True,
        related_name='questions',
        help_text='Leave empty for a cross-cutting question visible to all organizations',
    )

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_questions',
    )

    class Meta:
        ordering = ['text']

    def __str__(self):
        return self.text


class Assessment(models.Model):
    """A form: an ordered set of questions used for data collection."""

    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    questions = models.ManyToManyField(
        Question,
        through='AssessmentQuestion',
        related_name='assessments',
    )

    # Logic and flow
    logic_rules = models.JSONField(default=dict, blank=True, help_text='Conditional display rules')

    is_active = models.BooleanField(default=True)
    organizations = models.ManyToManyField(
        'organizations.Organization',
        blank=True,
        related_name='assessments'
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_assessments'
    )

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class AssessmentQuestion(models.Model):
    """Through model placing a Question on an Assessment (order, required, logic)."""

    assessment = models.ForeignKey(Assessment, on_delete=models.CASCADE)
    question = models.ForeignKey(Question, on_delete=models.CASCADE)
    order = models.PositiveIntegerField(default=0)
    is_required = models.BooleanField(default=True)

    # Conditional display
    depends_on = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='dependents'
    )
    condition_value = models.JSONField(null=True, blank=True, help_text='Value that triggers display')

    class Meta:
        ordering = ['order']
        unique_together = ['assessment', 'question']

    def __str__(self):
        return f"{self.assessment.name} - {self.question.text}"
