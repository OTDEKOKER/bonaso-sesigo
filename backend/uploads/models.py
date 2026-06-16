from django.db import models
import hashlib
import os


def upload_path(instance, filename):
    return f"uploads/{instance.organization.code if instance.organization else 'general'}/{filename}"


class Upload(models.Model):
    """File uploads model."""
    
    TYPE_CHOICES = [
        ('document', 'Document'),
        ('image', 'Image'),
        ('spreadsheet', 'Spreadsheet'),
        ('other', 'Other'),
    ]
    
    name = models.CharField(max_length=255)
    file = models.FileField(upload_to=upload_path)
    file_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='document')
    file_size = models.PositiveIntegerField(default=0)
    mime_type = models.CharField(max_length=100, blank=True)
    # SHA-256 fingerprint of the file contents. Lets us recognise that an
    # identical file has already been uploaded/imported (idempotency safeguard
    # IMP-1) so the UI can warn before re-processing and so repeated uploads are
    # traceable in the audit trail. Indexed for fast prior-upload lookups.
    file_hash = models.CharField(max_length=64, blank=True, db_index=True)

    description = models.TextField(blank=True)
    
    organization = models.ForeignKey(
        'organizations.Organization',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='uploads'
    )
    
    # Link to any model
    content_type = models.CharField(max_length=100, blank=True)
    object_id = models.IntegerField(null=True, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        related_name='uploads'
    )
    
    class Meta:
        ordering = ['-created_at']
    
    def __str__(self):
        return self.name

    def _compute_file_hash(self):
        """SHA-256 of the current file contents, or '' if it can't be read.

        Computed from the (still in-memory/temp) uploaded file before the field
        is persisted to storage, streaming in chunks so large files don't have
        to be held in memory. The read pointer is reset afterwards so the
        subsequent storage write still sees the full file.
        """
        hasher = hashlib.sha256()
        try:
            for chunk in self.file.chunks():
                hasher.update(chunk if isinstance(chunk, bytes) else chunk.encode('utf-8'))
        except Exception:
            return ''
        finally:
            try:
                self.file.seek(0)
            except Exception:
                pass
        return hasher.hexdigest()

    def save(self, *args, **kwargs):
        if self.file:
            self.file_size = self.file.size
            if not self.file_hash:
                self.file_hash = self._compute_file_hash()
            ext = os.path.splitext(self.file.name)[1].lower()
            if ext in ['.jpg', '.jpeg', '.png', '.gif']:
                self.file_type = 'image'
            elif ext in ['.xlsx', '.xls', '.xlsm', '.csv']:
                self.file_type = 'spreadsheet'
            elif ext in ['.pdf', '.doc', '.docx']:
                self.file_type = 'document'
        super().save(*args, **kwargs)

    def prior_imported_upload(self):
        """Most recent *other* upload with identical contents that has already
        completed an import, or ``None``. Used to flag repeated uploads."""
        if not self.file_hash:
            return None
        return (
            Upload.objects.filter(file_hash=self.file_hash)
            .exclude(pk=self.pk)
            .filter(import_jobs__status__in=['imported', 'completed', 'validated'])
            .order_by('-created_at')
            .distinct()
            .first()
        )


class ImportJob(models.Model):
    """Track data import jobs."""
    
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('uploaded', 'Uploaded'),
        ('analyzing', 'Analyzing'),
        ('ready_for_review', 'Ready for Review'),
        ('processing', 'Processing'),
        ('validated', 'Validated'),
        ('completed', 'Completed'),
        ('imported', 'Imported'),
        ('failed', 'Failed'),
    ]
    
    upload = models.ForeignKey(Upload, on_delete=models.CASCADE, related_name='import_jobs')
    job_type = models.CharField(max_length=50, default='upload_import')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    
    total_rows = models.PositiveIntegerField(default=0)
    processed_rows = models.PositiveIntegerField(default=0)
    successful_rows = models.PositiveIntegerField(default=0)
    failed_rows = models.PositiveIntegerField(default=0)
    
    errors = models.JSONField(default=list, blank=True)
    parameters = models.JSONField(default=dict, blank=True)
    result = models.JSONField(default=dict, blank=True)
    output_file = models.CharField(max_length=500, blank=True)
    
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        related_name='import_jobs'
    )
    
    class Meta:
        ordering = ['-created_at']
    
    def __str__(self):
        return f"Import: {self.upload.name} ({self.status})"


class ExportJob(models.Model):
    """Track generated export files."""

    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('processing', 'Processing'),
        ('completed', 'Completed'),
        ('failed', 'Failed'),
    ]

    MODE_CHOICES = [
        ('live', 'Live'),
        ('training', 'Training'),
    ]

    job_type = models.CharField(max_length=50, default='aggregate_export')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    # Environment the export belongs to (audit S-1). The background worker rebuilds
    # the request with force_authenticate(user=...) and therefore carries no JWT, so
    # the signed training/live ``mode`` claim is lost. We persist the caller's mode
    # at create time and replay it to the worker so a training export can never
    # silently run against — and leak — live data. See run_aggregate_export_job.
    mode = models.CharField(max_length=10, choices=MODE_CHOICES, default='live', db_index=True)
    parameters = models.JSONField(default=dict, blank=True)
    result = models.JSONField(default=dict, blank=True)
    output_file = models.CharField(max_length=500, blank=True)
    file_name = models.CharField(max_length=255, blank=True)
    content_type = models.CharField(max_length=150, blank=True)
    errors = models.JSONField(default=list, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        related_name='export_jobs'
    )

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Export: {self.job_type} ({self.status})"
