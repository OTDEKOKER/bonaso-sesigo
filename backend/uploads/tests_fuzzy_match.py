"""Regression tests for the legacy/fuzzy import hardening pass.

Proves the confidence engine and the resolvers that consume it:
  * low-confidence matches fail safely (no match),
  * ambiguous matches are refused (require an explicit override to confirm),
  * a wrong ORGANIZATION mapping cannot be chosen silently,
  * a wrong INDICATOR mapping cannot be chosen silently.

The SESIGO ``_cellmap`` path is deterministic and never touches this code.
"""
from django.test import SimpleTestCase, TestCase

from indicators.models import Indicator, IndicatorAlias
from organizations.models import Organization
from uploads.fuzzy_match import (
    ACCEPT_THRESHOLD,
    MatchResult,
    best_match,
    similarity,
)
from uploads.management.commands.import_reporting_workbook_overwrite import (
    IndicatorResolver,
    OrganizationResolver,
)


class _Obj:
    def __init__(self, name):
        self.name = name


class SimilarityTests(SimpleTestCase):
    def test_exact_is_one(self):
        self.assertEqual(similarity("BONELA", "bonela"), 1.0)
        self.assertEqual(similarity("Tebelopele Trust", "tebelopele   trust"), 1.0)

    def test_disjoint_is_zero(self):
        self.assertEqual(similarity("Gaborone Clinic", "Maun Hospital"), 0.0)
        self.assertEqual(similarity("", "anything"), 0.0)

    def test_partial_in_unit_interval(self):
        s = similarity("Health Network Alliance", "Health Partners Trust")
        self.assertGreater(s, 0.0)
        self.assertLess(s, ACCEPT_THRESHOLD)  # weak overlap → below the accept gate


class BestMatchTests(SimpleTestCase):
    def test_clear_winner_matches(self):
        choices = [_Obj("Tebelopele Wellness Centre"), _Obj("Maun District Hospital")]
        result = best_match("Tebelopele Wellness Centre", choices, label_of=lambda o: o.name)
        self.assertTrue(result.resolved)
        self.assertEqual(result.reason, "exact")
        self.assertEqual(result.confidence, 1.0)

    def test_low_confidence_refused(self):
        choices = [_Obj("Health Partners Trust")]
        result = best_match("Education Network Alliance", choices, label_of=lambda o: o.name)
        self.assertFalse(result.resolved)
        self.assertIn(result.reason, ("low_confidence", "no_candidates"))

    def test_ambiguous_refused(self):
        choices = [_Obj("Tebelopele Trust"), _Obj("Tebelopele Wellness")]
        result = best_match("Tebelopele", choices, label_of=lambda o: o.name)
        self.assertFalse(result.resolved)         # not written
        self.assertTrue(result.ambiguous)
        self.assertEqual(result.reason, "ambiguous")
        # …but both near-candidates are reported so a reviewer can override.
        self.assertEqual(len(result.alternatives()), 2)

    def test_no_candidates(self):
        result = best_match("Anything", [], label_of=lambda o: o.name)
        self.assertIsInstance(result, MatchResult)
        self.assertFalse(result.resolved)
        self.assertEqual(result.reason, "no_candidates")


class OrganizationResolverSafetyTests(TestCase):
    """The overwrite-command org resolver must never silently pick a wrong org."""

    def test_exact_match_still_resolves(self):
        org = Organization.objects.create(name="BONELA", code="FZ_BONELA", type="cso")
        resolver = OrganizationResolver()
        self.assertEqual(resolver.resolve("BONELA"), org)

    def test_ambiguous_two_orgs_refused(self):
        Organization.objects.create(name="Tebelopele Trust Gaborone", code="FZ_T1", type="cso")
        Organization.objects.create(name="Tebelopele Wellness Maun", code="FZ_T2", type="cso")
        resolver = OrganizationResolver()
        # A bare shared token matches both equally → must refuse (no silent pick).
        self.assertIsNone(resolver.resolve("Tebelopele"))

    def test_unrelated_name_refused(self):
        Organization.objects.create(name="BONELA", code="FZ_B2", type="cso")
        resolver = OrganizationResolver()
        self.assertIsNone(resolver.resolve("Completely Different Charity"))


class IndicatorResolverSafetyTests(TestCase):
    """The overwrite-command indicator resolver must not silently mis-map."""

    def test_alias_resolves_exactly(self):
        ind = Indicator.objects.create(name="Number of people tested for HIV", code="FZ_IND1", type="number")
        IndicatorAlias.objects.create(indicator=ind, name="HIV tests done", is_active=True)
        resolver = IndicatorResolver()
        self.assertEqual(resolver.resolve("HIV tests done"), ind)

    def test_nonsense_title_unmatched(self):
        Indicator.objects.create(name="Number of people tested for HIV", code="FZ_IND2", type="number")
        resolver = IndicatorResolver()
        self.assertIsNone(resolver.resolve("xyzzy unrelated gibberish token plugh"))

    def test_deprecated_alias_folds_to_canonical(self):
        canonical = Indicator.objects.create(name="Number reached canonical", code="FZ_CANON", type="number")
        dup = Indicator.objects.create(
            name="Number reached duplicate", code="FZ_DUP", type="number",
            canonical_indicator=canonical, is_deprecated=True,
        )
        IndicatorAlias.objects.create(indicator=dup, name="reached partner label", is_active=True)
        resolver = IndicatorResolver()
        # Alias points at the deprecated row but resolution folds onto canonical.
        self.assertEqual(resolver.resolve("reached partner label"), canonical)
