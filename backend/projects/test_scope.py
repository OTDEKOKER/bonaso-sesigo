from datetime import date

from django.test import TestCase

from organizations.models import Organization
from projects.models import Project, ProjectOrganization, ProjectOrganizationHierarchy
from projects.scope import (
    get_default_project_id,
    get_project_subtree_org_ids,
    get_user_project_ids,
    get_user_project_scope,
    user_can_access_project,
)
from users.models import User


class ProjectScopeTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        # Orgs: BONASO (lead), Coordinator, two sub-grantees, an unrelated org.
        cls.bonaso = Organization.objects.create(name="BONASO", code="SCOPE_BONASO", type="national")
        cls.coord = Organization.objects.create(name="Coordinator", code="SCOPE_COORD", type="district")
        cls.sub1 = Organization.objects.create(name="Sub 1", code="SCOPE_SUB1", type="cso")
        cls.sub2 = Organization.objects.create(name="Sub 2", code="SCOPE_SUB2", type="cso")
        cls.outside = Organization.objects.create(name="Outside", code="SCOPE_OUT", type="cso")

        cls.admin = User.objects.create_user(
            username="scope_admin", email="scope_admin@example.com",
            password="TestPass123!", role="admin", organization=cls.bonaso,
        )
        cls.lead_user = User.objects.create_user(
            username="scope_lead", email="scope_lead@example.com",
            password="TestPass123!", role="manager", organization=cls.bonaso,
        )
        cls.coord_user = User.objects.create_user(
            username="scope_coord", email="scope_coord@example.com",
            password="TestPass123!", role="officer", organization=cls.coord,
        )
        cls.sub_user = User.objects.create_user(
            username="scope_sub", email="scope_sub@example.com",
            password="TestPass123!", role="collector", organization=cls.sub1,
        )
        cls.outside_user = User.objects.create_user(
            username="scope_outside", email="scope_outside@example.com",
            password="TestPass123!", role="officer", organization=cls.outside,
        )

        cls.project = Project.objects.create(
            name="Hierarchy Project", code="SCOPE-P1",
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
            created_by=cls.admin,
        )
        for org, role in [
            (cls.bonaso, "lead"),
            (cls.coord, "coordinator"),
            (cls.sub1, "sub_grantee"),
            (cls.sub2, "sub_grantee"),
        ]:
            ProjectOrganization.objects.create(
                project=cls.project, organization=org, role=role, is_active=True,
            )
        # Project hierarchy: coordinator -> sub1, coordinator -> sub2.
        ProjectOrganizationHierarchy.objects.create(
            project=cls.project, parent_organization=cls.coord, child_organization=cls.sub1, is_active=True,
        )
        ProjectOrganizationHierarchy.objects.create(
            project=cls.project, parent_organization=cls.coord, child_organization=cls.sub2, is_active=True,
        )
        # Assign the non-admin users to the project (project-assignment gate).
        cls.project.assigned_users.add(
            cls.lead_user, cls.coord_user, cls.sub_user, cls.outside_user,
        )

    def test_subtree_includes_coordinator_and_children(self):
        self.assertEqual(
            get_project_subtree_org_ids(self.project, self.coord.id),
            {self.coord.id, self.sub1.id, self.sub2.id},
        )

    def test_subtree_of_leaf_is_just_itself(self):
        self.assertEqual(
            get_project_subtree_org_ids(self.project, self.sub1.id),
            {self.sub1.id},
        )

    def test_no_project_means_empty_scope(self):
        self.assertEqual(get_user_project_scope(self.coord_user, None), set())

    def test_admin_sees_whole_project(self):
        self.assertEqual(
            get_user_project_scope(self.admin, self.project),
            {self.bonaso.id, self.coord.id, self.sub1.id, self.sub2.id},
        )

    def test_lead_role_sees_whole_project(self):
        self.assertEqual(
            get_user_project_scope(self.lead_user, self.project),
            {self.bonaso.id, self.coord.id, self.sub1.id, self.sub2.id},
        )

    def test_coordinator_sees_own_cluster(self):
        self.assertEqual(
            get_user_project_scope(self.coord_user, self.project),
            {self.coord.id, self.sub1.id, self.sub2.id},
        )

    def test_sub_grantee_sees_only_itself(self):
        self.assertEqual(
            get_user_project_scope(self.sub_user, self.project),
            {self.sub1.id},
        )

    def test_user_outside_project_sees_nothing(self):
        # Assigned to the project, but their org is not part of the project scope.
        self.assertEqual(get_user_project_scope(self.outside_user, self.project), set())

    def test_user_not_assigned_to_project_sees_nothing(self):
        # Same org as the coordinator, but NOT assigned to the project.
        unassigned = User.objects.create_user(
            username="scope_unassigned", email="scope_unassigned@example.com",
            password="TestPass123!", role="officer", organization=self.coord,
        )
        self.assertFalse(user_can_access_project(unassigned, self.project))
        self.assertEqual(get_user_project_scope(unassigned, self.project), set())

    def test_get_user_project_ids_for_assigned_user(self):
        self.assertEqual(get_user_project_ids(self.coord_user), {self.project.id})

    def test_get_user_project_ids_admin_is_none(self):
        # None means "all projects — no assignment restriction".
        self.assertIsNone(get_user_project_ids(self.admin))

    def test_admin_can_access_unassigned_project(self):
        self.assertTrue(user_can_access_project(self.admin, self.project))

    def test_default_project_for_assigned_user(self):
        self.assertEqual(get_default_project_id(self.coord_user), self.project.id)

    def test_default_project_for_admin(self):
        self.assertEqual(get_default_project_id(self.admin), self.project.id)

    def test_default_project_none_when_user_has_no_assignments(self):
        user = User.objects.create_user(
            username="scope_noproj", email="scope_noproj@example.com",
            password="TestPass123!", role="officer", organization=self.coord,
        )
        self.assertIsNone(get_default_project_id(user))

    def test_default_project_excludes_training_in_live_mode(self):
        self.project.is_training = True
        self.project.save(update_fields=["is_training"])
        self.assertIsNone(get_default_project_id(self.coord_user))
        self.assertEqual(
            get_default_project_id(self.coord_user, include_training=True),
            self.project.id,
        )
