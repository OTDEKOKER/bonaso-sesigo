from rest_framework import serializers
from .models import Upload, ImportJob, ExportJob


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
