from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from django.db import models
from django.db.models import Q

from organizations.access import is_organization_admin, training_view_mode
from users.permissions import IsDataEntryUser
from respondents.models import Interaction
from .models import Profile, ProfileField
from .serializers import ProfileSerializer, ProfileFieldSerializer


class ProfileViewSet(viewsets.ModelViewSet):
    """ViewSet for managing respondent profiles.

    Profiles hold special-category personal data (health_status, disabilities,
    income_level, employment_status). Access is therefore gated to admins +
    data-handling roles (``IsDataEntryUser`` — excludes external ``client``
    stakeholders and unknown roles), org-scoped in ``get_queryset``, and
    isolated across the Sesigo Live / Training boundary. A Profile carries no
    ``is_training`` of its own — its environment is defined by the projects of
    its respondent's interactions — so mode isolation mirrors RespondentViewSet
    (subqueries on the mode-clean Interaction table).
    """

    queryset = Profile.objects.all()
    serializer_class = ProfileSerializer
    permission_classes = [IsAuthenticated, IsDataEntryUser]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['respondent']

    def get_queryset(self):
        user = self.request.user
        if is_organization_admin(user):
            queryset = Profile.objects.all()
        elif getattr(user, 'organization_id', None):
            queryset = Profile.objects.filter(respondent__organization_id=user.organization_id)
        else:
            return Profile.objects.none()

        # Live / Training isolation (mirrors RespondentViewSet). A live session
        # must not see profiles that exist only under training projects, and a
        # training session must see only those; admin include_training=true
        # ("all") skips the filter.
        mode = training_view_mode(self.request)
        if mode == "training":
            training_ids = Interaction.objects.filter(
                project__is_training=True
            ).values("respondent_id")
            queryset = queryset.filter(respondent_id__in=training_ids)
        elif mode == "live":
            live_ids = Interaction.objects.filter(
                Q(project__is_training=False) | Q(project__isnull=True)
            ).values("respondent_id")
            any_ids = Interaction.objects.values("respondent_id")
            queryset = queryset.filter(
                Q(respondent_id__in=live_ids) | ~Q(respondent_id__in=any_ids)
            )
        # Deterministic order so LIMIT/OFFSET pagination is stable.
        return queryset.order_by('-created_at', '-id')


class ProfileFieldViewSet(viewsets.ModelViewSet):
    """ViewSet for managing custom profile fields.

    Field definitions describe the profile form structure and are scoped to the
    org (or global). Gated to data-handling roles for the same reason as the
    profiles they configure.
    """

    queryset = ProfileField.objects.all()
    serializer_class = ProfileFieldSerializer
    permission_classes = [IsAuthenticated, IsDataEntryUser]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['organization', 'field_type']

    def get_queryset(self):
        user = self.request.user
        if is_organization_admin(user):
            return ProfileField.objects.all()
        return ProfileField.objects.filter(
            models.Q(organization=user.organization) |
            models.Q(organization__isnull=True)
        )
