from datetime import date

from django.test import TestCase
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIRequestFactory

from organizations.models import Organization
from projects.models import Project
from projects.serializers import ProjectSerializer
from users.models import User
from users.serializers import UserCreateSerializer, UserUpdateSerializer


class UserProjectAssignmentTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = Organization.objects.create(name="Org", code="PA_ORG", type="cso")
        cls.admin = User.objects.create_user(
            username="pa_admin", email="pa_admin@example.com",
            password="TestPass123!", role="admin", organization=cls.org,
        )
        cls.officer = User.objects.create_user(
            username="pa_officer", email="pa_officer@example.com",
            password="TestPass123!", role="officer", organization=cls.org,
        )
        cls.project_a = Project.objects.create(
            name="Project A", code="PA-A", start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31), created_by=cls.admin,
        )
        cls.project_b = Project.objects.create(
            name="Project B", code="PA-B", start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31), created_by=cls.admin,
        )
        cls.factory = APIRequestFactory()

    def _request(self, user):
        request = self.factory.post("/")
        request.user = user
        return request

    def test_admin_creates_user_with_multiple_assigned_projects(self):
        serializer = UserCreateSerializer(
            data={
                "username": "pa_newuser",
                "email": "pa_newuser@example.com",
                "role": "officer",
                "organization": self.org.id,
                "password": "TestPass123!",
                "password_confirm": "TestPass123!",
                "assigned_projects": [self.project_a.id, self.project_b.id],
            },
            context={"request": self._request(self.admin)},
        )
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        self.assertEqual(
            set(user.assigned_projects.values_list("id", flat=True)),
            {self.project_a.id, self.project_b.id},
        )

    def test_non_admin_cannot_assign_projects_when_creating_user(self):
        serializer = UserCreateSerializer(
            data={
                "username": "pa_blocked",
                "email": "pa_blocked@example.com",
                "role": "officer",
                "organization": self.org.id,
                "password": "TestPass123!",
                "password_confirm": "TestPass123!",
                "assigned_projects": [self.project_a.id],
            },
            context={"request": self._request(self.officer)},
        )
        serializer.is_valid(raise_exception=True)
        with self.assertRaises(ValidationError):
            serializer.save()

    def test_admin_updates_user_assigned_projects(self):
        self.officer.assigned_projects.set([self.project_a])
        serializer = UserUpdateSerializer(
            instance=self.officer,
            data={"assigned_projects": [self.project_b.id]},
            partial=True,
            context={"request": self._request(self.admin)},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        self.officer.refresh_from_db()
        self.assertEqual(
            set(self.officer.assigned_projects.values_list("id", flat=True)),
            {self.project_b.id},
        )

    def test_admin_assigns_users_to_project_via_project_serializer(self):
        serializer = ProjectSerializer(
            instance=self.project_a,
            data={"assigned_users": [self.officer.id]},
            partial=True,
            context={"request": self._request(self.admin)},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        self.assertEqual(
            set(self.project_a.assigned_users.values_list("id", flat=True)),
            {self.officer.id},
        )

    def test_non_admin_cannot_assign_users_to_project(self):
        serializer = ProjectSerializer(
            instance=self.project_a,
            data={"assigned_users": [self.officer.id]},
            partial=True,
            context={"request": self._request(self.officer)},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        # Non-admin edit is silently ignored (existing assignment preserved = none).
        self.assertEqual(self.project_a.assigned_users.count(), 0)
