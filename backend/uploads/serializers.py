import os

from django.conf import settings
from rest_framework import serializers
from .models import Upload, ImportJob, ExportJob


# SEC: allowlist of permitted upload extensions. Uploaded files are stored under
# MEDIA and served back from the same origin, so an unrestricted FileField is a
# stored-XSS vector: a user could upload .html/.svg/.js that the browser renders
# (and X-Content-Type-Options: nosniff does NOT help when the file is *served*
# with an active content-type such as text/html or image/svg+xml). We allowlist
# the business document/image/spreadsheet types the product actually uses and
# reject everything else, rather than chasing a denylist of dangerous types.
ALLOWED_UPLOAD_EXTENSIONS = frozenset({
    # documents
    '.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt', '.ppt', '.pptx',
    # spreadsheets
    '.xlsx', '.xls', '.xlsm', '.csv', '.ods',
    # images
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff',
})

# Hard cap on uploaded file size. DATA/FILE_UPLOAD_MAX_MEMORY_SIZE only control
# the in-memory threshold (larger files stream to a temp file) — they are not a
# size limit. This is the actual ceiling. Default 50 MiB; override via env.
MAX_UPLOAD_BYTES = getattr(settings, 'MAX_UPLOAD_BYTES', None) or int(
    os.getenv('MAX_UPLOAD_BYTES', str(50 * 1024 * 1024))
)


class UploadSerializer(serializers.ModelSerializer):
    """Serializer for Upload model."""

    organization_name = serializers.CharField(source='organization.name', read_only=True)
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = Upload
        fields = [
            'id', 'name', 'file', 'file_url', 'file_type', 'file_size', 'mime_type',
            'description', 'organization', 'organization_name',
            'content_type', 'object_id',
            'created_at', 'created_by', 'created_by_name'
        ]
        read_only_fields = ['id', 'file_size', 'file_type', 'created_at', 'created_by']

    def validate_file(self, value):
        ext = os.path.splitext(getattr(value, 'name', '') or '')[1].lower()
        if ext not in ALLOWED_UPLOAD_EXTENSIONS:
            raise serializers.ValidationError(
                f"File type '{ext or 'unknown'}' is not allowed. Permitted types: "
                + ', '.join(sorted(e.lstrip('.') for e in ALLOWED_UPLOAD_EXTENSIONS))
                + '.'
            )
        size = getattr(value, 'size', 0) or 0
        if size > MAX_UPLOAD_BYTES:
            raise serializers.ValidationError(
                f"File is too large ({size} bytes). Maximum allowed is {MAX_UPLOAD_BYTES} bytes."
            )
        return value

    def get_file_url(self, obj):
        if obj.file:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.file.url)
        return None


class ImportJobSerializer(serializers.ModelSerializer):
    """Serializer for ImportJob model."""
    
    upload_name = serializers.CharField(source='upload.name', read_only=True)
    progress = serializers.SerializerMethodField()
    
    class Meta:
        model = ImportJob
        fields = [
            'id', 'upload', 'upload_name', 'job_type', 'status',
            'total_rows', 'processed_rows', 'successful_rows', 'failed_rows',
            'progress', 'errors', 'parameters', 'result', 'output_file', 'started_at', 'completed_at',
            'created_at', 'created_by'
        ]
        read_only_fields = ['id', 'created_at', 'created_by']
    
    def get_progress(self, obj):
        if obj.total_rows == 0:
            return 0
        return int((obj.processed_rows / obj.total_rows) * 100)


class ExportJobSerializer(serializers.ModelSerializer):
    """Serializer for export jobs."""

    created_by_name = serializers.CharField(source='created_by.username', read_only=True)
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = ExportJob
        fields = [
            'id', 'job_type', 'status', 'parameters', 'result', 'output_file',
            'file_name', 'content_type', 'errors', 'download_url',
            'started_at', 'completed_at', 'created_at', 'created_by', 'created_by_name'
        ]
        read_only_fields = [
            'id', 'status', 'result', 'output_file', 'file_name', 'content_type',
            'errors', 'started_at', 'completed_at', 'created_at', 'created_by',
        ]

    def get_download_url(self, obj):
        if obj.status != 'completed' or not obj.output_file:
            return None
        return f"/api/uploads/exports/{obj.id}/download/"
