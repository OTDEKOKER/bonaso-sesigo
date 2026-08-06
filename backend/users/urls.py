from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    CookieTokenObtainPairView, CookieTokenRefreshView,
    current_user, confidentiality_acknowledgement, logout_view, TestConnectionView,
    ApplyForNewUser, AdminResetPasswordView, UserViewSet,
    ChangePasswordView, PasswordResetRequestCreateView, PasswordResetRequestListView,
    PasswordResetRequestApproveView, PasswordResetRequestRejectView,
)

router = DefaultRouter()
router.register(r'', UserViewSet, basename='user')  # handles /api/users/

urlpatterns = [
    # JWT Auth
    path('request-token/', CookieTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('token/refresh/', CookieTokenRefreshView.as_view(), name='token_refresh'),
    
    # User info
    path('me/', current_user, name='current_user'),
    path('confidentiality-acknowledgement/', confidentiality_acknowledgement, name='confidentiality_acknowledgement'),
    path('logout/', logout_view, name='logout'),
    
    # Test
    path('test-connection/', TestConnectionView.as_view(), name='test_connection'),
    
    # Create / admin
    path('create-user/', ApplyForNewUser.as_view(), name='create_user'),
    path('admin-reset-password/', AdminResetPasswordView.as_view(), name='admin_reset_password'),

    # Self-service password change (DPA expiry) + admin-approved reset requests.
    # Declared before the router include so these fixed paths are not swallowed
    # by the UserViewSet detail route registered at the empty prefix.
    path('change-password/', ChangePasswordView.as_view(), name='change_password'),
    path('password-reset-request/', PasswordResetRequestCreateView.as_view(), name='password_reset_request'),
    path('password-reset-requests/', PasswordResetRequestListView.as_view(), name='password_reset_request_list'),
    path('password-reset-requests/<int:pk>/approve/', PasswordResetRequestApproveView.as_view(), name='password_reset_request_approve'),
    path('password-reset-requests/<int:pk>/reject/', PasswordResetRequestRejectView.as_view(), name='password_reset_request_reject'),

    # Include ViewSet
    path('', include(router.urls)),
]
