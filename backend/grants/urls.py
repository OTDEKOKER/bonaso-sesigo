from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    GrantBudgetLineViewSet,
    GrantDisbursementViewSet,
    GrantExpenditureViewSet,
    GrantViewSet,
)

router = DefaultRouter()
router.register("budget-lines", GrantBudgetLineViewSet, basename="grant-budget-lines")
router.register("disbursements", GrantDisbursementViewSet, basename="grant-disbursements")
router.register("expenditures", GrantExpenditureViewSet, basename="grant-expenditures")
router.register("", GrantViewSet, basename="grants")

urlpatterns = [
    path("", include(router.urls)),
]
