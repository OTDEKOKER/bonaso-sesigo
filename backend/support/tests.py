"""Support / help-desk tests: creation, permission scoping, lifecycle
transitions, audit history reuse, notifications, and comment visibility.
"""
from __future__ import annotations

from datetime import date

from rest_framework import status
from rest_framework.test import APITestCase

from audit.models import AuditEvent
from messaging.models import Notification
from organizations.models import Organization
from projects.models import Project
from support.models import SupportTicket, SupportTicketComment
from users.models import User


class SupportBase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org_a = Organization.objects.create(name="Org A", code="SUP_A", type="cso")
        cls.org_b = Organization.objects.create(name="Org B", code="SUP_B", type="cso")

        cls.admin = User.objects.create_user(
            username="sup_admin", email="a@x.com", password="TestPass123!",
            role="admin", organization=cls.org_a,
        )
        cls.manager = User.objects.create_user(  # support staff
            username="sup_mgr", email="m@x.com", password="TestPass123!",
            role="manager", organization=cls.org_a,
        )
        cls.reporter = User.objects.create_user(  # org A reporter (collector)
            username="sup_reporter", email="r@x.com", password="TestPass123!",
            role="collector", organization=cls.org_a,
        )
        cls.outsider = User.objects.create_user(  # org B officer
            username="sup_outsider", email="o@x.com", password="TestPass123!",
            role="officer", organization=cls.org_b,
        )
        cls.client_user = User.objects.create_user(
            username="sup_client", email="c@x.com", password="TestPass123!",
            role="client", organization=cls.org_a,
        )
        cls.project = Project.objects.create(
            name="P", code="SUP-P", status="active",
            start_date=date(2024, 1, 1), end_date=date(2099, 1, 1), created_by=cls.admin,
        )

    def _create_ticket(self, user, **overrides):
        self.client.force_authenticate(user=user)
        payload = {
            "title": "Cannot upload workbook",
            "description": "The upload fails with a validation error.",
            "category": "workbook_upload",
            "severity": "high",
            "affected_organization": self.org_a.id,
            "affected_project": self.project.id,
        }
        payload.update(overrides)
        return self.client.post("/api/support/tickets/", payload, format="json")


class CreationTests(SupportBase):
    def test_reporter_can_raise_ticket_and_defaults_are_safe(self):
        resp = self._create_ticket(self.reporter)
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)
        ticket = SupportTicket.objects.get(id=resp.data["id"])
        self.assertEqual(ticket.status, SupportTicket.STATUS_NEW)
        self.assertEqual(ticket.reporter_id, self.reporter.id)
        self.assertEqual(ticket.reporter_username, "sup_reporter")
        # status/assigned_to cannot be set at creation (read-only in serializer).
        self.assertIsNone(ticket.assigned_to_id)

    def test_client_user_may_raise_a_ticket(self):
        resp = self._create_ticket(self.client_user)
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)

    def test_creation_writes_audit_event_and_notifies_staff(self):
        before = AuditEvent.objects.filter(object_type="support_ticket").count()
        resp = self._create_ticket(self.reporter)
        self.assertEqual(
            AuditEvent.objects.filter(
                object_type="support_ticket", object_id=str(resp.data["id"]),
                metadata__event="created",
            ).count(), 1)
        self.assertGreater(AuditEvent.objects.filter(object_type="support_ticket").count(), before)
        # admin + manager are staff → both notified (reporter excluded).
        self.assertTrue(Notification.objects.filter(user=self.manager).exists())
        self.assertTrue(Notification.objects.filter(user=self.admin).exists())
        self.assertFalse(Notification.objects.filter(user=self.reporter).exists())

    def test_cannot_inject_status_or_reporter_at_create(self):
        resp = self._create_ticket(self.reporter, status="approved", reporter=self.admin.id)
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        ticket = SupportTicket.objects.get(id=resp.data["id"])
        self.assertEqual(ticket.status, SupportTicket.STATUS_NEW)
        self.assertEqual(ticket.reporter_id, self.reporter.id)


class VisibilityTests(SupportBase):
    def setUp(self):
        self.ticket = SupportTicket.objects.create(
            title="t", description="d", affected_organization=self.org_a,
            reporter=self.reporter, reporter_username="sup_reporter",
        )

    def _list_ids(self, user):
        self.client.force_authenticate(user=user)
        resp = self.client.get("/api/support/tickets/")
        self.assertEqual(resp.status_code, 200, resp.content)
        results = resp.data["results"] if isinstance(resp.data, dict) else resp.data
        return {t["id"] for t in results}

    def test_reporter_sees_own_ticket(self):
        self.assertIn(self.ticket.id, self._list_ids(self.reporter))

    def test_admin_sees_all(self):
        self.assertIn(self.ticket.id, self._list_ids(self.admin))

    def test_outsider_in_other_org_cannot_see(self):
        self.assertNotIn(self.ticket.id, self._list_ids(self.outsider))

    def test_assignee_sees_assigned_ticket(self):
        self.ticket.assigned_to = self.outsider
        self.ticket.save(update_fields=["assigned_to"])
        self.assertIn(self.ticket.id, self._list_ids(self.outsider))

    def test_outsider_cannot_retrieve_directly(self):
        self.client.force_authenticate(user=self.outsider)
        resp = self.client.get(f"/api/support/tickets/{self.ticket.id}/")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)


class LifecycleTests(SupportBase):
    def setUp(self):
        self.ticket = SupportTicket.objects.create(
            title="t", description="d", severity="high",
            affected_organization=self.org_a, reporter=self.reporter,
            reporter_username="sup_reporter",
        )

    def test_non_staff_cannot_assign(self):
        self.client.force_authenticate(user=self.reporter)
        resp = self.client.post(f"/api/support/tickets/{self.ticket.id}/assign/",
                                {"assigned_to": self.manager.id}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_staff_assign_sets_acknowledged_and_notifies(self):
        self.client.force_authenticate(user=self.admin)
        resp = self.client.post(f"/api/support/tickets/{self.ticket.id}/assign/",
                                {"assigned_to": self.manager.id}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.assigned_to_id, self.manager.id)
        self.assertEqual(self.ticket.status, SupportTicket.STATUS_ACKNOWLEDGED)
        self.assertTrue(Notification.objects.filter(user=self.manager).exists())
        self.assertEqual(AuditEvent.objects.filter(
            object_type="support_ticket", object_id=str(self.ticket.id),
            metadata__event="assignment").count(), 1)

    def test_invalid_status_transition_rejected(self):
        self.client.force_authenticate(user=self.admin)
        # new -> resolved is not a legal staff transition (must be acknowledged/…).
        resp = self.client.post(f"/api/support/tickets/{self.ticket.id}/set_status/",
                                {"status": "resolved"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.status, SupportTicket.STATUS_NEW)

    def test_resolve_and_reporter_reopen(self):
        self.client.force_authenticate(user=self.admin)
        self.client.post(f"/api/support/tickets/{self.ticket.id}/set_status/",
                         {"status": "investigating"}, format="json")
        resp = self.client.post(f"/api/support/tickets/{self.ticket.id}/resolve/",
                                {"resolution_notes": "Fixed the mapping."}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.status, SupportTicket.STATUS_RESOLVED)
        self.assertIsNotNone(self.ticket.resolved_at)
        self.assertEqual(self.ticket.resolved_by_id, self.admin.id)
        self.assertEqual(self.ticket.resolution_notes, "Fixed the mapping.")
        # reporter reopens
        self.client.force_authenticate(user=self.reporter)
        resp = self.client.post(f"/api/support/tickets/{self.ticket.id}/reopen/", {}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.status, SupportTicket.STATUS_REOPENED)
        self.assertIsNone(self.ticket.resolved_at)

    def test_reporter_cannot_arbitrarily_change_status(self):
        self.client.force_authenticate(user=self.reporter)
        resp = self.client.post(f"/api/support/tickets/{self.ticket.id}/set_status/",
                                {"status": "investigating"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_non_staff_cannot_patch_details(self):
        self.client.force_authenticate(user=self.reporter)
        resp = self.client.patch(f"/api/support/tickets/{self.ticket.id}/",
                                 {"title": "hijacked"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_set_priority_staff_only_and_audited(self):
        self.client.force_authenticate(user=self.reporter)
        denied = self.client.post(f"/api/support/tickets/{self.ticket.id}/set_priority/",
                                  {"priority": "urgent"}, format="json")
        self.assertEqual(denied.status_code, status.HTTP_403_FORBIDDEN)
        self.client.force_authenticate(user=self.admin)
        resp = self.client.post(f"/api/support/tickets/{self.ticket.id}/set_priority/",
                                {"priority": "urgent", "severity": "critical"}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.priority, "urgent")
        self.assertEqual(self.ticket.severity, "critical")
        self.assertTrue(AuditEvent.objects.filter(
            object_type="support_ticket", object_id=str(self.ticket.id),
            metadata__event="priority_change").exists())


class CommentTests(SupportBase):
    def setUp(self):
        self.ticket = SupportTicket.objects.create(
            title="t", description="d", affected_organization=self.org_a,
            reporter=self.reporter, reporter_username="sup_reporter",
            assigned_to=self.manager,
        )

    def test_reporter_can_comment_and_staff_notified(self):
        self.client.force_authenticate(user=self.reporter)
        resp = self.client.post(f"/api/support/tickets/{self.ticket.id}/comments/",
                                {"content": "Any update?"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)
        self.assertTrue(Notification.objects.filter(user=self.manager).exists())

    def test_internal_comment_hidden_from_reporter(self):
        # staff posts an internal note
        self.client.force_authenticate(user=self.manager)
        self.client.post(f"/api/support/tickets/{self.ticket.id}/comments/",
                         {"content": "internal triage", "is_internal": True}, format="json")
        # reporter posts a normal comment
        self.client.force_authenticate(user=self.reporter)
        self.client.post(f"/api/support/tickets/{self.ticket.id}/comments/",
                         {"content": "public"}, format="json")
        # reporter GET sees only the non-internal one
        resp = self.client.get(f"/api/support/tickets/{self.ticket.id}/comments/")
        contents = [c["content"] for c in resp.data]
        self.assertIn("public", contents)
        self.assertNotIn("internal triage", contents)
        # staff sees both
        self.client.force_authenticate(user=self.manager)
        resp = self.client.get(f"/api/support/tickets/{self.ticket.id}/comments/")
        contents = [c["content"] for c in resp.data]
        self.assertIn("internal triage", contents)

    def test_reporter_cannot_mark_comment_internal(self):
        self.client.force_authenticate(user=self.reporter)
        self.client.post(f"/api/support/tickets/{self.ticket.id}/comments/",
                         {"content": "trying internal", "is_internal": True}, format="json")
        c = SupportTicketComment.objects.get(ticket=self.ticket, content="trying internal")
        self.assertFalse(c.is_internal)


class HistoryAndStatsTests(SupportBase):
    def test_history_endpoint_lists_events(self):
        self.client.force_authenticate(user=self.admin)
        resp = self.client.post("/api/support/tickets/", {
            "title": "x", "description": "y", "category": "other", "severity": "low",
        }, format="json")
        tid = resp.data["id"]
        self.client.post(f"/api/support/tickets/{tid}/assign/",
                         {"assigned_to": self.manager.id}, format="json")
        resp = self.client.get(f"/api/support/tickets/{tid}/history/")
        events = [e["event"] for e in resp.data]
        self.assertIn("created", events)
        self.assertIn("assignment", events)

    def test_stats_endpoint(self):
        SupportTicket.objects.create(title="a", description="d", reporter=self.reporter,
                                     affected_organization=self.org_a, status="new")
        self.client.force_authenticate(user=self.admin)
        resp = self.client.get("/api/support/tickets/stats/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("open", resp.data)
        self.assertIn("by_status", resp.data)
