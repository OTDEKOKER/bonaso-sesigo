from django.db import models


class Project(models.Model):
    """Project model for scoping data collection."""
    
    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('active', 'Active'),
        ('completed', 'Completed'),
        ('archived', 'Archived'),
    ]
    
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=50, unique=True)
    description = models.TextField(blank=True)
    funder = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')
    
    start_date = models.DateField()
    end_date = models.DateField()
    
    # Linked indicators
    indicators = models.ManyToManyField(
        'indicators.Indicator',
        through='ProjectIndicator',
        related_name='projects'
    )
    
    # Organization scope
    organizations = models.ManyToManyField(
        'organizations.Organization',
        blank=True,
        related_name='projects'
    )
    hierarchy_overrides = models.JSONField(default=dict, blank=True)
    
    # Training mode: records linked to training projects are excluded from
    # official dashboards, reports, and aggregates by default.
    is_training = models.BooleanField(
        default=False,
        help_text=(
            "Training projects are used for practical exercises. Their data is "
            "excluded from official dashboards and reports by default and may be "
            "automatically cleared after 7 days."
        ),
    )
    training_expires_after_days = models.PositiveIntegerField(
        default=7,
        help_text="Number of days after which training data is eligible for automatic cleanup.",
    )
    training_notes = models.TextField(
        blank=True,
        default="",
        help_text="Internal notes about this training project or session.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_projects'
    )
    
    class Meta:
        ordering = ['-start_date']
    
    def __str__(self):
        return f"{self.name} ({self.code})"
    
    @property
    def progress_percentage(self):
        """Calculate project progress based on targets."""
        indicators = self.projectindicator_set.all()
        if not indicators:
            return 0
        total = sum(1 for i in indicators if i.current_value >= i.target_value)
        return int((total / indicators.count()) * 100)


class ProjectIndicator(models.Model):
    """Through model for Project-Indicator with targets."""

    project = models.ForeignKey(Project, on_delete=models.CASCADE)
    indicator = models.ForeignKey('indicators.Indicator', on_delete=models.CASCADE)
    # Target group narrows which population this project uses the indicator for.
    # Keeps the canonical indicator name generic (e.g. "Number of people reached")
    # while capturing specificity here (e.g. "PLHIV", "Youth 15-24", "Women").
    target_group = models.CharField(
        max_length=255,
        blank=True,
        help_text='e.g. PLHIV, AYP (10-24), Women, KP, MSM, FSW',
    )
    # Financial-year quarterly targets are persisted on this row as the
    # roll-up of organization-scoped rows for backward compatibility.
    q1_target = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    q2_target = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    q3_target = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    q4_target = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    target_value = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    current_value = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    baseline_value = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    
    class Meta:
        unique_together = ['project', 'indicator']
    
    def __str__(self):
        return f"{self.project.name} - {self.indicator.name}"


class ProjectIndicatorOrganizationTarget(models.Model):
    """
    Organization-scoped quarterly targets for a project indicator.

    This model matches the long-lived projects_projectindicatororganizationtarget
    table that legacy code previously accessed via raw SQL.
    """

    project_indicator = models.ForeignKey(
        ProjectIndicator,
        on_delete=models.CASCADE,
        related_name='organization_targets',
    )
    organization = models.ForeignKey(
        'organizations.Organization',
        on_delete=models.CASCADE,
        related_name='project_indicator_targets',
    )
    q1_target = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    q2_target = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    q3_target = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    q4_target = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    target_value = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    current_value = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    baseline_value = models.DecimalField(max_digits=15, decimal_places=2, default=0)

    class Meta:
        unique_together = ['project_indicator', 'organization']

    def __str__(self):
        return (
            f"{self.project_indicator.project.code} / "
            f"{self.project_indicator.indicator.code} / "
            f"{self.organization.code}"
        )


class ProjectIndicatorAssignment(models.Model):
    """Project-scoped indicator assignment to an organization."""

    SOURCE_CHOICES = [
        ('project_scope', 'Project Scope'),
        ('organization_target', 'Organization Target'),
        ('manual', 'Manual'),
        ('aggregate_history', 'Aggregate History'),
    ]

    project_indicator = models.ForeignKey(
        ProjectIndicator,
        on_delete=models.CASCADE,
        related_name='assignments',
    )
    project_organization = models.ForeignKey(
        'projects.ProjectOrganization',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='project_indicator_assignments',
    )
    organization = models.ForeignKey(
        'organizations.Organization',
        on_delete=models.CASCADE,
        related_name='project_indicator_assignments',
    )
    assignment_source = models.CharField(
        max_length=32,
        choices=SOURCE_CHOICES,
        default='project_scope',
    )
    is_active = models.BooleanField(default=True)
    assignment_metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ['project_indicator', 'organization']
        ordering = ['project_indicator_id', 'organization_id']

    def __str__(self):
        return (
            f"{self.project_indicator.project.code} / "
            f"{self.project_indicator.indicator.code} / "
            f"{self.organization.code} ({self.assignment_source})"
        )

    def save(self, *args, **kwargs):
        if self.project_organization_id:
            if (
                self.project_indicator_id
                and self.project_organization.project_id != self.project_indicator.project_id
            ):
                # Never allow cross-project assignment references.
                self.project_organization = None
            else:
                # Keep legacy organization FK aligned with project assignment.
                self.organization_id = self.project_organization.organization_id
        super().save(*args, **kwargs)


class ProjectIndicatorDisaggregationRule(models.Model):
    """Project-scoped disaggregation rules for a project indicator."""

    project_indicator = models.ForeignKey(
        ProjectIndicator,
        on_delete=models.CASCADE,
        related_name='disaggregation_rules',
    )
    organization = models.ForeignKey(
        'organizations.Organization',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='project_indicator_disaggregation_rules',
    )
    dimension_key = models.CharField(max_length=64)
    display_label = models.CharField(max_length=128, blank=True)
    is_required = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)
    config = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ['project_indicator', 'organization', 'dimension_key']
        ordering = ['project_indicator_id', 'sort_order', 'id']

    def __str__(self):
        org_code = getattr(self.organization, 'code', 'ALL_ORGS')
        return (
            f"{self.project_indicator.project.code} / "
            f"{self.project_indicator.indicator.code} / "
            f"{org_code} / {self.dimension_key}"
        )


class ProjectOrganization(models.Model):
    """Project-scoped organization membership and role."""

    ROLE_CHOICES = [
        ('lead', 'Lead'),
        ('coordinator', 'Coordinator'),
        ('sub_grantee', 'Sub-grantee'),
        ('implementing_partner', 'Implementing Partner'),
        ('data_reviewer', 'Data Reviewer'),
        ('funder', 'Funder'),
        ('other', 'Other'),
    ]

    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name='project_organizations',
    )
    client = models.ForeignKey(
        'projects.ClientOrganization',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='project_assignments',
    )
    organization = models.ForeignKey(
        'organizations.Organization',
        on_delete=models.CASCADE,
        related_name='project_memberships',
    )
    parent_assignment = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='child_assignments',
    )
    cluster = models.CharField(max_length=255, blank=True, default='')
    role = models.CharField(
        max_length=32,
        choices=ROLE_CHOICES,
        default='implementing_partner',
    )
    is_coordinator = models.BooleanField(default=False)
    is_sub_grantee = models.BooleanField(default=False)
    is_implementer = models.BooleanField(default=True)
    can_report_indicators = models.BooleanField(default=True)
    thematic_areas = models.JSONField(default=list, blank=True)
    districts_localities = models.JSONField(default=list, blank=True)
    contract_start_date = models.DateField(null=True, blank=True)
    contract_end_date = models.DateField(null=True, blank=True)
    source_sheet = models.CharField(max_length=255, blank=True, default='')
    source_row = models.PositiveIntegerField(null=True, blank=True)
    is_training = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    implementation_scope = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ['project', 'organization']
        ordering = ['project_id', 'organization_id']

    def __str__(self):
        return f"{self.project.code} / {self.organization.code} ({self.role})"


class ProjectOrganizationHierarchy(models.Model):
    """Project-scoped parent-child organization links."""

    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name='project_hierarchy_links',
    )
    parent_organization = models.ForeignKey(
        'organizations.Organization',
        on_delete=models.CASCADE,
        related_name='project_hierarchy_parent_links',
    )
    child_organization = models.ForeignKey(
        'organizations.Organization',
        on_delete=models.CASCADE,
        related_name='project_hierarchy_child_links',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ['project', 'parent_organization', 'child_organization']
        ordering = ['project_id', 'parent_organization_id', 'child_organization_id']
        constraints = [
            models.CheckConstraint(
                check=~models.Q(parent_organization=models.F('child_organization')),
                name='project_hierarchy_parent_child_must_differ',
            ),
        ]

    def __str__(self):
        return (
            f"{self.project.code}: "
            f"{self.parent_organization.code} -> {self.child_organization.code}"
        )


class Task(models.Model):
    """Task model for project activities."""
    
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('in_progress', 'In Progress'),
        ('completed', 'Completed'),
        ('cancelled', 'Cancelled'),
    ]
    
    PRIORITY_CHOICES = [
        ('low', 'Low'),
        ('medium', 'Medium'),
        ('high', 'High'),
        ('urgent', 'Urgent'),
    ]
    
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='tasks')
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default='medium')
    
    assigned_to = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='assigned_tasks'
    )
    
    due_date = models.DateField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_tasks'
    )
    
    class Meta:
        ordering = ['due_date', '-priority']
    
    def __str__(self):
        return f"{self.name} ({self.project.name})"


class Deadline(models.Model):
    """Deadline model for reporting deadlines."""
    
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('submitted', 'Submitted'),
        ('approved', 'Approved'),
        ('overdue', 'Overdue'),
    ]
    
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='deadlines')
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    due_date = models.DateField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    
    # Indicators to report on
    indicators = models.ManyToManyField('indicators.Indicator', blank=True)
    
    submitted_at = models.DateTimeField(null=True, blank=True)
    submitted_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='submitted_deadlines'
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['due_date']
    
    def __str__(self):
        return f"{self.name} - {self.due_date}"


class ProjectActivity(models.Model):
    """A project activity/milestone item visible to project members."""

    STATUS_CHOICES = [
        ('planned', 'Planned'),
        ('ongoing', 'Ongoing'),
        ('completed', 'Completed'),
        ('cancelled', 'Cancelled'),
    ]

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='activities')
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='planned')
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    # If set, cascade visibility to child orgs
    visible_to_all = models.BooleanField(default=True)
    organization = models.ForeignKey(
        'organizations.Organization',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='project_activities',
    )
    created_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_project_activities',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['start_date', 'title']

    def __str__(self):
        return f"{self.project.name} – {self.title}"


class ClientOrganization(models.Model):
    """Client/funder organization linked to one or more projects."""

    name = models.CharField(max_length=255, unique=True)
    description = models.TextField(blank=True)
    contact_name = models.CharField(max_length=255, blank=True)
    contact_email = models.EmailField(blank=True)
    contact_phone = models.CharField(max_length=50, blank=True)
    website = models.URLField(blank=True)
    is_active = models.BooleanField(default=True)
    projects = models.ManyToManyField(Project, blank=True, related_name='client_organizations')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class NarrativeReport(models.Model):
    """Narrative report document uploaded for a project/organization."""

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='narrative_reports')
    organization = models.ForeignKey(
        'organizations.Organization',
        on_delete=models.CASCADE,
        related_name='narrative_reports',
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    file = models.FileField(upload_to='narrative_reports/%Y/%m/')
    file_name = models.CharField(max_length=255, blank=True)
    uploaded_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        related_name='uploaded_narrative_reports',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.project.name} – {self.title}"

    def save(self, *args, **kwargs):
        if self.file and not self.file_name:
            self.file_name = self.file.name.split('/')[-1]
        super().save(*args, **kwargs)
