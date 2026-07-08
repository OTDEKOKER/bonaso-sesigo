from datetime import date

from rest_framework import status
from rest_framework.test import APITestCase

from indicators.models import Indicator
from organizations.models import Organization
from projects.models import (
    Project,
    ProjectIndicator,
    ProjectIndicatorAssignment,
    ProjectIndicatorDisaggregationRule,
    ProjectIndicatorOrganizationTarget,
    ProjectOrganization,
    ProjectOrganizationHierarchy,
)
from respondents.models import Interaction, Respondent
from users.models import User


class ProjectTargetSchemaStabilizationTests(APITestCase):
    def setUp(self):
        self.org = Organization.objects.create(name='Org A', code='ORG_A_PROJ', type='district')
        self.admin = User.objects.create_user(
            username='project_admin',
            email='project_admin@example.com',
            password='TestPass123!',
            role='admin',
            organization=self.org,
        )
        self.client.force_authenticate(self.admin)

        self.project = Project.objects.create(
            name='Project 2026',
            code='PROJ-2026',
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
            created_by=self.admin,
        )
        self.project.organizations.add(self.org)

        self.indicator = Indicator.objects.create(
            name='People reached',
            code='IND_PROJ_2026',
            type='number',
            category='hiv_prevention',
            created_by=self.admin,
        )

    def _assign_indicator_and_target(self, q1=10, q2=20, q3=30, q4=40, baseline=5):
        assign_response = self.client.post(
            f'/api/manage/projects/{self.project.id}/assign_indicators/',
            {'indicator_ids': [self.indicator.id]},
            format='json',
        )
        self.assertEqual(assign_response.status_code, status.HTTP_200_OK)

        target_response = self.client.post(
            f'/api/manage/projects/{self.project.id}/set_target/',
            {
                'indicator_id': self.indicator.id,
                'organization_id': self.org.id,
                'q1_target': q1,
                'q2_target': q2,
                'q3_target': q3,
                'q4_target': q4,
                'baseline_value': baseline,
            },
            format='json',
        )
        self.assertEqual(target_response.status_code, status.HTTP_200_OK)

    def test_project_detail_still_loads_indicator_and_organization_targets(self):
        self._assign_indicator_and_target()

        response = self.client.get(f'/api/manage/projects/{self.project.id}/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()

        self.assertIn('project_indicators', payload)
        self.assertIn('organization_targets', payload)
        self.assertEqual(len(payload['project_indicators']), 1)
        self.assertEqual(len(payload['organization_targets']), 1)

        target_row = payload['organization_targets'][0]
        expected_keys = {
            'id',
            'project',
            'project_name',
            'project_code',
            'indicator',
            'indicator_name',
            'indicator_code',
            'organization',
            'organization_name',
            'organization_code',
            'q1_target',
            'q2_target',
            'q3_target',
            'q4_target',
            'target_value',
            'current_value',
            'baseline_value',
            'progress',
        }
        self.assertTrue(expected_keys.issubset(set(target_row.keys())))

    def test_set_target_updates_existing_org_target_without_duplicates(self):
        self._assign_indicator_and_target(q1=1, q2=2, q3=3, q4=4, baseline=0)
        self._assign_indicator_and_target(q1=2, q2=4, q3=6, q4=8, baseline=1)

        self.assertEqual(ProjectIndicator.objects.filter(project=self.project, indicator=self.indicator).count(), 1)
        self.assertEqual(
            ProjectIndicatorOrganizationTarget.objects.filter(
                project_indicator__project=self.project,
                project_indicator__indicator=self.indicator,
                organization=self.org,
            ).count(),
            1,
        )

        project_indicator = ProjectIndicator.objects.get(project=self.project, indicator=self.indicator)
        self.assertEqual(float(project_indicator.q1_target), 2.0)
        self.assertEqual(float(project_indicator.q2_target), 4.0)
        self.assertEqual(float(project_indicator.q3_target), 6.0)
        self.assertEqual(float(project_indicator.q4_target), 8.0)
        self.assertEqual(float(project_indicator.target_value), 20.0)
        self.assertEqual(float(project_indicator.baseline_value), 1.0)

    def test_aggregate_templates_and_dashboard_overview_shape_still_works(self):
        self._assign_indicator_and_target()

        templates_response = self.client.get(f'/api/aggregates/templates/?project={self.project.id}')
        self.assertEqual(templates_response.status_code, status.HTTP_200_OK)
        templates_payload = templates_response.json()
        self.assertIsInstance(templates_payload, list)
        self.assertGreaterEqual(len(templates_payload), 1)
        first_template = templates_payload[0]
        self.assertIn('id', first_template)
        self.assertIn('name', first_template)
        self.assertIn('indicators', first_template)
        self.assertIsInstance(first_template['indicators'], list)
        self.assertGreaterEqual(len(first_template['indicators']), 1)
        first_indicator = first_template['indicators'][0]
        self.assertTrue({'id', 'name', 'code', 'type', 'disaggregation_fields'}.issubset(set(first_indicator.keys())))

        dashboard_response = self.client.get(f'/api/analysis/dashboard/overview/?project={self.project.id}')
        self.assertEqual(dashboard_response.status_code, status.HTTP_200_OK)
        dashboard_payload = dashboard_response.json()
        self.assertTrue(
            {
                'total_respondents',
                'total_assessments',
                'active_projects',
                'total_indicators',
                'indicators_behind',
                'recent_activity',
            }.issubset(set(dashboard_payload.keys()))
        )

    def test_reporting_form_interaction_capture_path_still_works(self):
        self._assign_indicator_and_target()
        respondent = Respondent.objects.create(
            unique_id='RESP_PROJ_1',
            first_name='Jane',
            last_name='Doe',
            organization=self.org,
            created_by=self.admin,
        )

        create_response = self.client.post(
            '/api/record/interactions/',
            {
                'respondent': respondent.id,
                'project': self.project.id,
                'date': '2026-02-01',
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)

        list_response = self.client.get('/api/record/interactions/')
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        list_payload = list_response.json()
        self.assertIn('results', list_payload)
        self.assertEqual(len(list_payload['results']), 1)


class ProjectScopeSyncCompatibilityTests(APITestCase):
    def setUp(self):
        self.org_parent = Organization.objects.create(
            name='Org Parent',
            code='ORG_PARENT_SCOPE',
            type='district',
        )
        self.org_child = Organization.objects.create(
            name='Org Child',
            code='ORG_CHILD_SCOPE',
            type='district',
        )
        self.org_other = Organization.objects.create(
            name='Org Other',
            code='ORG_OTHER_SCOPE',
            type='district',
        )
        self.admin = User.objects.create_user(
            username='scope_admin',
            email='scope_admin@example.com',
            password='TestPass123!',
            role='admin',
            organization=self.org_parent,
        )
        self.client.force_authenticate(self.admin)

    def test_create_project_keeps_phase2_scope_tables_synced(self):
        response = self.client.post(
            '/api/manage/projects/',
            {
                'name': 'Scoped Project 2026',
                'code': 'SCOPED-2026',
                'start_date': '2026-01-01',
                'end_date': '2026-12-31',
                'organizations': [self.org_parent.id, self.org_child.id],
                'hierarchy_overrides': {
                    str(self.org_parent.id): [str(self.org_child.id)],
                },
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        project_id = response.json()['id']

        memberships = ProjectOrganization.objects.filter(project_id=project_id, is_active=True)
        self.assertEqual(memberships.count(), 2)
        self.assertTrue(memberships.filter(organization=self.org_parent).exists())
        self.assertTrue(memberships.filter(organization=self.org_child).exists())

        hierarchy_links = ProjectOrganizationHierarchy.objects.filter(project_id=project_id, is_active=True)
        self.assertEqual(hierarchy_links.count(), 1)
        self.assertTrue(
            hierarchy_links.filter(
                parent_organization=self.org_parent,
                child_organization=self.org_child,
            ).exists()
        )

    def test_update_project_deactivates_stale_scope_rows_without_breaking_legacy_fields(self):
        create_response = self.client.post(
            '/api/manage/projects/',
            {
                'name': 'Scoped Project 2027',
                'code': 'SCOPED-2027',
                'start_date': '2027-01-01',
                'end_date': '2027-12-31',
                'organizations': [self.org_parent.id, self.org_child.id],
                'hierarchy_overrides': {
                    str(self.org_parent.id): [str(self.org_child.id)],
                },
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        project_id = create_response.json()['id']

        update_response = self.client.patch(
            f'/api/manage/projects/{project_id}/',
            {
                'organizations': [self.org_parent.id, self.org_other.id],
                'hierarchy_overrides': {
                    str(self.org_parent.id): [str(self.org_other.id)],
                },
            },
            format='json',
        )
        self.assertEqual(update_response.status_code, status.HTTP_200_OK)

        self.assertTrue(
            ProjectOrganization.objects.filter(
                project_id=project_id,
                organization=self.org_parent,
                is_active=True,
            ).exists()
        )
        self.assertTrue(
            ProjectOrganization.objects.filter(
                project_id=project_id,
                organization=self.org_other,
                is_active=True,
            ).exists()
        )
        self.assertTrue(
            ProjectOrganization.objects.filter(
                project_id=project_id,
                organization=self.org_child,
                is_active=False,
            ).exists()
        )

        self.assertTrue(
            ProjectOrganizationHierarchy.objects.filter(
                project_id=project_id,
                parent_organization=self.org_parent,
                child_organization=self.org_other,
                is_active=True,
            ).exists()
        )
        self.assertTrue(
            ProjectOrganizationHierarchy.objects.filter(
                project_id=project_id,
                parent_organization=self.org_parent,
                child_organization=self.org_child,
                is_active=False,
            ).exists()
        )

        project = Project.objects.get(id=project_id)
        self.assertEqual(
            set(project.organizations.values_list('id', flat=True)),
            {self.org_parent.id, self.org_other.id},
        )
        self.assertEqual(
            project.hierarchy_overrides,
            {str(self.org_parent.id): [str(self.org_other.id)]},
        )


class ProjectIndicatorAssignmentCompatibilityTests(APITestCase):
    def setUp(self):
        self.org_a = Organization.objects.create(
            name='Org Assign A',
            code='ORG_ASSIGN_A',
            type='district',
        )
        self.org_b = Organization.objects.create(
            name='Org Assign B',
            code='ORG_ASSIGN_B',
            type='district',
        )
        self.admin = User.objects.create_user(
            username='assignment_admin',
            email='assignment_admin@example.com',
            password='TestPass123!',
            role='admin',
            organization=self.org_a,
        )
        self.client.force_authenticate(self.admin)

        self.project = Project.objects.create(
            name='Indicator Assignment Project',
            code='IAP-2026',
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
            created_by=self.admin,
        )
        self.project.organizations.add(self.org_a, self.org_b)

        self.indicator = Indicator.objects.create(
            name='Assigned Indicator',
            code='IND_ASSIGN_2026',
            type='number',
            category='hiv_prevention',
            created_by=self.admin,
        )

    def test_assign_indicators_creates_project_scope_assignments(self):
        response = self.client.post(
            f'/api/manage/projects/{self.project.id}/assign_indicators/',
            {'indicator_ids': [self.indicator.id]},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        project_indicator = ProjectIndicator.objects.get(
            project=self.project,
            indicator=self.indicator,
        )
        assignments = ProjectIndicatorAssignment.objects.filter(project_indicator=project_indicator, is_active=True)
        self.assertEqual(assignments.count(), 2)
        self.assertTrue(assignments.filter(organization=self.org_a, assignment_source='project_scope').exists())
        self.assertTrue(assignments.filter(organization=self.org_b, assignment_source='project_scope').exists())

    def test_set_target_promotes_assignment_source_to_organization_target(self):
        self.client.post(
            f'/api/manage/projects/{self.project.id}/assign_indicators/',
            {'indicator_ids': [self.indicator.id]},
            format='json',
        )

        response = self.client.post(
            f'/api/manage/projects/{self.project.id}/set_target/',
            {
                'indicator_id': self.indicator.id,
                'organization_id': self.org_a.id,
                'q1_target': 5,
                'q2_target': 10,
                'q3_target': 15,
                'q4_target': 20,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        project_indicator = ProjectIndicator.objects.get(
            project=self.project,
            indicator=self.indicator,
        )
        self.assertTrue(
            ProjectIndicatorAssignment.objects.filter(
                project_indicator=project_indicator,
                organization=self.org_a,
                assignment_source='organization_target',
                is_active=True,
            ).exists()
        )

    def test_project_scope_update_deactivates_scope_assignments_for_removed_org(self):
        self.client.post(
            f'/api/manage/projects/{self.project.id}/assign_indicators/',
            {'indicator_ids': [self.indicator.id]},
            format='json',
        )
        update_response = self.client.patch(
            f'/api/manage/projects/{self.project.id}/',
            {
                'organizations': [self.org_a.id],
            },
            format='json',
        )
        self.assertEqual(update_response.status_code, status.HTTP_200_OK)

        project_indicator = ProjectIndicator.objects.get(
            project=self.project,
            indicator=self.indicator,
        )
        self.assertTrue(
            ProjectIndicatorAssignment.objects.filter(
                project_indicator=project_indicator,
                organization=self.org_b,
                assignment_source='project_scope',
                is_active=False,
            ).exists()
        )

    def test_disaggregation_rule_model_is_available_for_project_indicator(self):
        self.client.post(
            f'/api/manage/projects/{self.project.id}/assign_indicators/',
            {'indicator_ids': [self.indicator.id]},
            format='json',
        )
        project_indicator = ProjectIndicator.objects.get(
            project=self.project,
            indicator=self.indicator,
        )

        rule = ProjectIndicatorDisaggregationRule.objects.create(
            project_indicator=project_indicator,
            organization=self.org_a,
            dimension_key='age_band',
            display_label='Age Band',
            is_required=True,
            sort_order=1,
            config={'bands': ['10-14', '15-19', '20-24']},
        )
        self.assertEqual(rule.dimension_key, 'age_band')
        self.assertEqual(rule.config['bands'][0], '10-14')


class ProjectSetupAndReportingEnforcementTests(APITestCase):
    def setUp(self):
        self.org_a = Organization.objects.create(
            name='Org Setup A',
            code='ORG_SETUP_A',
            type='district',
        )
        self.org_b = Organization.objects.create(
            name='Org Setup B',
            code='ORG_SETUP_B',
            type='district',
        )
        self.admin = User.objects.create_user(
            username='setup_admin',
            email='setup_admin@example.com',
            password='TestPass123!',
            role='admin',
            organization=self.org_a,
        )
        self.client.force_authenticate(self.admin)

        self.project = Project.objects.create(
            name='Setup Project',
            code='SETUP-2026',
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
            created_by=self.admin,
        )
        self.project.organizations.add(self.org_a, self.org_b)

        self.indicator_a = Indicator.objects.create(
            name='Setup Indicator A',
            code='IND_SETUP_A',
            type='number',
            category='hiv_prevention',
            created_by=self.admin,
        )
        self.indicator_b = Indicator.objects.create(
            name='Setup Indicator B',
            code='IND_SETUP_B',
            type='number',
            category='hiv_prevention',
            created_by=self.admin,
        )

    def test_project_setup_endpoint_returns_scope_fields(self):
        self.client.post(
            f'/api/manage/projects/{self.project.id}/assign_indicators/',
            {'indicator_ids': [self.indicator_a.id]},
            format='json',
        )
        response = self.client.get(f'/api/manage/projects/{self.project.id}/setup/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        self.assertIn('project_organizations', payload)
        self.assertIn('project_hierarchy_links', payload)
        self.assertIn('project_indicator_assignments', payload)
        self.assertIn('project_disaggregation_rules', payload)
        self.assertTrue(payload.get('project_setup_ready'))

    def test_set_organization_roles_updates_project_membership_roles(self):
        response = self.client.post(
            f'/api/manage/projects/{self.project.id}/set_organization_roles/',
            {
                'roles': [
                    {'organization_id': self.org_a.id, 'role': 'lead', 'is_active': True},
                    {'organization_id': self.org_b.id, 'role': 'sub_grantee', 'is_active': True},
                ]
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(
            ProjectOrganization.objects.filter(
                project=self.project,
                organization=self.org_a,
                role='lead',
                is_active=True,
            ).exists()
        )
        self.assertTrue(
            ProjectOrganization.objects.filter(
                project=self.project,
                organization=self.org_b,
                role='sub_grantee',
                is_active=True,
            ).exists()
        )
        membership_org_b = ProjectOrganization.objects.get(
            project=self.project,
            organization=self.org_b,
        )
        self.assertTrue(membership_org_b.is_sub_grantee)
        self.assertTrue(membership_org_b.can_report_indicators)

    def test_set_indicator_assignments_updates_assignments_and_rules(self):
        response = self.client.post(
            f'/api/manage/projects/{self.project.id}/set_indicator_assignments/',
            {
                'replace': True,
                'assignments': [
                    {
                        'indicator_id': self.indicator_a.id,
                        'organization_ids': [self.org_a.id],
                        'disaggregation_rules': [
                            {'dimension_key': 'age_band', 'display_label': 'Age Band', 'is_required': True},
                            {'dimension_key': 'sex', 'display_label': 'Sex', 'is_required': True},
                        ],
                    },
                    {
                        'indicator_id': self.indicator_b.id,
                        'organization_ids': [self.org_b.id],
                        'disaggregation_rules': [
                            {'dimension_key': 'district', 'display_label': 'District', 'is_required': False},
                        ],
                    },
                ],
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        project_indicator_a = ProjectIndicator.objects.get(project=self.project, indicator=self.indicator_a)
        project_indicator_b = ProjectIndicator.objects.get(project=self.project, indicator=self.indicator_b)
        self.assertTrue(
            ProjectIndicatorAssignment.objects.filter(
                project_indicator=project_indicator_a,
                organization=self.org_a,
                assignment_source='manual',
                is_active=True,
            ).exists()
        )
        self.assertTrue(
            ProjectIndicatorAssignment.objects.filter(
                project_indicator=project_indicator_b,
                organization=self.org_b,
                assignment_source='manual',
                is_active=True,
            ).exists()
        )
        self.assertTrue(
            ProjectIndicatorDisaggregationRule.objects.filter(
                project_indicator=project_indicator_a,
                dimension_key='age_band',
                is_active=True,
            ).exists()
        )
        self.assertTrue(
            ProjectIndicatorDisaggregationRule.objects.filter(
                project_indicator=project_indicator_b,
                dimension_key='district',
                is_active=True,
            ).exists()
        )

    def test_indicator_assignment_links_project_assignment_and_supports_coordinator_implementer_reporting(self):
        self.client.post(
            f'/api/manage/projects/{self.project.id}/set_organization_roles/',
            {
                'roles': [
                    {
                        'organization_id': self.org_a.id,
                        'role': 'coordinator',
                        'is_coordinator': True,
                        'is_implementer': True,
                        'can_report_indicators': True,
                        'is_active': True,
                    },
                ],
            },
            format='json',
        )

        response = self.client.post(
            f'/api/manage/projects/{self.project.id}/set_indicator_assignments/',
            {
                'replace': True,
                'assignments': [
                    {
                        'indicator_id': self.indicator_a.id,
                        'organization_ids': [self.org_a.id],
                        'disaggregation_rules': [],
                    },
                ],
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        project_indicator = ProjectIndicator.objects.get(
            project=self.project,
            indicator=self.indicator_a,
        )
        assignment = ProjectIndicatorAssignment.objects.get(
            project_indicator=project_indicator,
            organization=self.org_a,
            is_active=True,
        )
        self.assertIsNotNone(assignment.project_organization_id)
        self.assertEqual(assignment.project_organization.organization_id, self.org_a.id)
        self.assertTrue(assignment.project_organization.is_coordinator)
        self.assertTrue(assignment.project_organization.is_implementer)

        aggregate_response = self.client.post(
            '/api/aggregates/',
            {
                'indicator': self.indicator_a.id,
                'project': self.project.id,
                'organization': self.org_a.id,
                'period_start': '2026-04-01',
                'period_end': '2026-06-30',
                'value': {'total': 12},
            },
            format='json',
        )
        self.assertEqual(aggregate_response.status_code, status.HTTP_201_CREATED)

    def test_project_setup_payload_includes_partner_coverage_fields(self):
        self.client.post(
            f'/api/manage/projects/{self.project.id}/set_organization_roles/',
            {
                'roles': [
                    {
                        'organization_id': self.org_a.id,
                        'role': 'lead',
                        'cluster': 'NCD',
                        'thematic_areas': ['Hypertension and Diabetes'],
                        'districts': ['Gaborone'],
                        'localities': ['Tlokweng'],
                        'is_active': True,
                    },
                ],
            },
            format='json',
        )

        response = self.client.get(f'/api/manage/projects/{self.project.id}/setup/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        first_row = payload.get('project_organizations', [])[0]
        self.assertIn('partner_type', first_row)
        self.assertIn('reporting_status', first_row)
        self.assertIn('thematic_areas', first_row)
        self.assertIn('districts', first_row)
        self.assertIn('localities', first_row)

    def test_bonaso_is_labeled_senior_coordinator(self):
        # Hierarchy: Client -> Project -> overseen by BONASO -> coordinates
        # through Coordinator Orgs -> manage Sub-grantees. BONASO is the sole
        # Project Senior Coordinator / Admin (not a coordinator). The coverage
        # page must label BONASO as Project Senior Coordinator / Admin purely
        # from BONASO detection — so we assign it a neutral (non-lead,
        # non-coordinator) role here to prove the label is not from the role.
        bonaso = Organization.objects.create(name='BONASO', code='BONASO_OVS', type='headquarters')
        # A non-BONASO NGO sub-grantee: must NOT be labeled senior coordinator.
        sub = Organization.objects.create(name='Some Sub-grantee NGO', code='SUB_OVS', type='ngo')
        self.project.organizations.add(bonaso, sub)
        self.client.post(
            f'/api/manage/projects/{self.project.id}/set_organization_roles/',
            {
                'roles': [
                    {'organization_id': bonaso.id, 'role': 'implementing_partner', 'is_active': True},
                    {'organization_id': sub.id, 'role': 'implementing_partner', 'is_active': True},
                ],
            },
            format='json',
        )
        response = self.client.get(f'/api/manage/projects/{self.project.id}/setup/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        rows = response.json().get('project_organizations', [])
        bonaso_row = next((r for r in rows if str(r.get('organization')) == str(bonaso.id)), None)
        self.assertIsNotNone(bonaso_row, 'BONASO row missing from coverage payload')
        self.assertEqual(bonaso_row.get('partner_type'), 'Project Senior Coordinator / Admin')
        sub_row = next((r for r in rows if str(r.get('organization')) == str(sub.id)), None)
        self.assertIsNotNone(sub_row, 'Sub-grantee row missing from coverage payload')
        self.assertNotEqual(sub_row.get('partner_type'), 'Project Senior Coordinator / Admin')

    def test_interaction_capture_rejects_unassigned_indicator_for_project(self):
        self.client.post(
            f'/api/manage/projects/{self.project.id}/set_indicator_assignments/',
            {
                'replace': True,
                'assignments': [
                    {
                        'indicator_id': self.indicator_a.id,
                        'organization_ids': [self.org_a.id],
                        'disaggregation_rules': [],
                    },
                    {
                        'indicator_id': self.indicator_b.id,
                        'organization_ids': [self.org_b.id],
                        'disaggregation_rules': [],
                    },
                ],
            },
            format='json',
        )

        respondent = Respondent.objects.create(
            unique_id='RESP_SETUP_001',
            first_name='Setup',
            last_name='Tester',
            organization=self.org_a,
            created_by=self.admin,
        )

        interaction_response = self.client.post(
            '/api/record/interactions/',
            {
                'respondent': respondent.id,
                'project': self.project.id,
                'date': '2026-03-01',
            },
            format='json',
        )
        self.assertEqual(interaction_response.status_code, status.HTTP_201_CREATED)
        interaction_id = Interaction.objects.order_by('-id').values_list('id', flat=True).first()
        self.assertIsNotNone(interaction_id)

        disallowed_response = self.client.post(
            f'/api/record/interactions/{interaction_id}/add_response/',
            {
                'indicator': self.indicator_b.id,
                'value': {'total': 10},
            },
            format='json',
        )
        self.assertEqual(disallowed_response.status_code, status.HTTP_403_FORBIDDEN)

        allowed_response = self.client.post(
            f'/api/record/interactions/{interaction_id}/add_response/',
            {'indicator': self.indicator_a.id, 'value': {'total': 5}},
            format='json',
        )
        self.assertEqual(allowed_response.status_code, status.HTTP_201_CREATED)

    def test_set_hierarchy_links_writes_normalized_rows_and_dual_writes_json(self):
        """
        set_hierarchy_links should:
        - write ProjectOrganizationHierarchy rows
        - dual-write hierarchy_overrides JSON for backward compat
        - deactivate stale links on replace=True
        """
        # Set links: org_a → org_b
        response = self.client.post(
            f'/api/manage/projects/{self.project.id}/set_hierarchy_links/',
            {
                'replace': True,
                'links': [
                    {
                        'parent_organization_id': self.org_a.id,
                        'child_organization_id': self.org_b.id,
                    },
                ],
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json().get('links_updated'), 1)

        # Normalized row created
        self.assertTrue(
            ProjectOrganizationHierarchy.objects.filter(
                project=self.project,
                parent_organization=self.org_a,
                child_organization=self.org_b,
                is_active=True,
            ).exists()
        )

        # JSON dual-write
        self.project.refresh_from_db()
        overrides = self.project.hierarchy_overrides or {}
        self.assertIn(str(self.org_a.id), overrides)
        self.assertIn(str(self.org_b.id), overrides[str(self.org_a.id)])

        # Replace with empty list deactivates the existing link
        response2 = self.client.post(
            f'/api/manage/projects/{self.project.id}/set_hierarchy_links/',
            {'replace': True, 'links': []},
            format='json',
        )
        self.assertEqual(response2.status_code, status.HTTP_200_OK)
        self.assertFalse(
            ProjectOrganizationHierarchy.objects.filter(
                project=self.project,
                is_active=True,
            ).exists()
        )
        self.project.refresh_from_db()
        self.assertEqual(self.project.hierarchy_overrides, {})


class ProjectLightDetailProjectionTests(APITestCase):
    """?light=1 must drop the heavy per-org fields the browse pickers never read,
    while the default (full) detail keeps them for Project Setup / Targets."""

    def setUp(self):
        self.admin = User.objects.create_user(
            username='light_admin', email='light_admin@example.com',
            password='TestPass123!', role='admin',
        )
        self.client.force_authenticate(self.admin)
        self.coord = Organization.objects.create(name='Light Coord', code='LIGHT_COORD', type='district')
        self.sub = Organization.objects.create(name='Light Sub', code='LIGHT_SUB', type='cso', parent=self.coord)
        self.project = Project.objects.create(
            name='Light Project', code='LIGHT-1',
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
            created_by=self.admin,
        )
        self.project.organizations.add(self.coord, self.sub)
        self.indicator = Indicator.objects.create(
            name='Light Indicator', code='LIGHT_IND', type='number',
            category='hiv_prevention', created_by=self.admin,
        )
        self.pi = ProjectIndicator.objects.create(project=self.project, indicator=self.indicator)
        # One assignment + hierarchy link so the heavy/kept fields are non-empty.
        ProjectIndicatorAssignment.objects.create(
            project_indicator=self.pi, organization=self.sub, is_active=True,
        )
        ProjectOrganizationHierarchy.objects.create(
            project=self.project, parent_organization=self.coord,
            child_organization=self.sub, is_active=True,
        )

    HEAVY = ('project_indicator_assignments', 'project_disaggregation_rules', 'project_organizations')
    KEPT = ('project_indicators', 'organization_targets', 'project_hierarchy_links', 'organizations')

    def test_full_detail_includes_heavy_fields(self):
        response = self.client.get(f'/api/manage/projects/{self.project.id}/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        for field in self.HEAVY + self.KEPT:
            self.assertIn(field, body)
        self.assertEqual(len(body['project_indicator_assignments']), 1)

    def test_light_detail_omits_heavy_but_keeps_needed(self):
        response = self.client.get(f'/api/manage/projects/{self.project.id}/?light=1')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        for field in self.HEAVY:
            self.assertNotIn(field, body)
        for field in self.KEPT:
            self.assertIn(field, body)
        # The kept fields still carry their data (hierarchy link + indicator).
        self.assertEqual(len(body['project_hierarchy_links']), 1)
        self.assertEqual(len(body['project_indicators']), 1)
