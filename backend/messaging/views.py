from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from django.utils import timezone
from django.db.models import Q

from .models import Announcement, Message, Notification
from .serializers import AnnouncementSerializer, MessageSerializer, NotificationSerializer


class AnnouncementViewSet(viewsets.ModelViewSet):
    """ViewSet for announcements."""

    queryset = Announcement.objects.select_related('created_by', 'organization', 'project').all()
    serializer_class = AnnouncementSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['scope', 'organization', 'project']
    search_fields = ['title', 'content']
    ordering = ['-created_at']

    def get_queryset(self):
        from django.db.models import Q
        user = self.request.user
        qs = Announcement.objects.select_related('created_by', 'organization', 'project')
        if getattr(user, 'role', None) == 'admin':
            return qs
        # Non-admins see global announcements + those scoped to their org
        org_id = getattr(user, 'organization_id', None)
        return qs.filter(
            Q(scope='global') |
            Q(scope='organization', organization_id=org_id)
        )

    def perform_create(self, serializer):
        # Keep project-scoped announcements on the correct side of the
        # training/live boundary (audit finding H4). The guard no-ops when the
        # announcement is not tied to a project.
        from organizations.access import assert_project_write_allowed
        assert_project_write_allowed(self.request, serializer.validated_data.get('project'))
        serializer.save(created_by=self.request.user)


class MessageViewSet(viewsets.ModelViewSet):
    """ViewSet for managing messages."""
    
    queryset = Message.objects.all()
    serializer_class = MessageSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['message_type', 'is_read']
    
    def get_queryset(self):
        user = self.request.user
        # Return messages where user is sender or recipient
        return Message.objects.filter(
            Q(sender=user) | Q(recipient=user)
        )
    
    def perform_create(self, serializer):
        serializer.save(sender=self.request.user)
    
    @action(detail=False, methods=['get'])
    def inbox(self, request):
        """Get received messages."""
        messages = Message.objects.filter(recipient=request.user)
        return Response(MessageSerializer(messages, many=True).data)
    
    @action(detail=False, methods=['get'])
    def sent(self, request):
        """Get sent messages."""
        messages = Message.objects.filter(sender=request.user)
        return Response(MessageSerializer(messages, many=True).data)
    
    @action(detail=True, methods=['post'])
    def mark_read(self, request, pk=None):
        """Mark message as read."""
        message = self.get_object()
        if message.recipient == request.user:
            message.is_read = True
            message.read_at = timezone.now()
            message.save()
        return Response(MessageSerializer(message).data)
    
    @action(detail=False, methods=['post'])
    def mark_all_read(self, request):
        """Mark all messages as read."""
        Message.objects.filter(
            recipient=request.user,
            is_read=False
        ).update(is_read=True, read_at=timezone.now())
        return Response({'detail': 'All messages marked as read.'})

    @action(detail=False, methods=['get'])
    def unread_count(self, request):
        count = Message.objects.filter(recipient=request.user, is_read=False).count()
        return Response({'count': count})


class NotificationViewSet(viewsets.ModelViewSet):
    """ViewSet for managing notifications."""
    
    queryset = Notification.objects.all()
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['is_read']
    
    def get_queryset(self):
        return Notification.objects.filter(user=self.request.user)
    
    @action(detail=True, methods=['post'])
    def mark_read(self, request, pk=None):
        """Mark notification as read."""
        notification = self.get_object()
        notification.is_read = True
        notification.save()
        return Response(NotificationSerializer(notification).data)
    
    @action(detail=False, methods=['post'])
    def mark_all_read(self, request):
        """Mark all notifications as read."""
        Notification.objects.filter(
            user=request.user,
            is_read=False
        ).update(is_read=True)
        return Response({'detail': 'All notifications marked as read.'})
    
    @action(detail=False, methods=['get'])
    def unread_count(self, request):
        """Get unread notification count."""
        count = Notification.objects.filter(
            user=request.user,
            is_read=False
        ).count()
        return Response({'count': count})
