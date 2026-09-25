"""URL patterns for accounts: auth pages, profile, and settings."""
from django.urls import path

from . import views

app_name = 'accounts'

urlpatterns = [
    path('register/', views.register_view, name='register'),
    path('login/', views.LoginView.as_view(), name='login'),
    path('logout/', views.LogoutView.as_view(), name='logout'),
    path('profile/', views.profile_view, name='profile'),
    path('users/<int:user_id>/avatar/', views.avatar_view, name='avatar'),
    path('settings/', views.settings_view, name='settings'),
    path('settings/phone/', views.phone_change_view, name='phone_change'),
    path('password-change/', views.password_change_view, name='password_change'),
    path(
        'password-change/done/',
        views.CustomPasswordChangeDoneView.as_view(),
        name='password_change_done',
    ),
    path('api/phone-available/', views.phone_available, name='phone_available'),
    # Password reset flow
    path('password-reset/', views.CustomPasswordResetView.as_view(), name='password_reset'),
    path(
        'password-reset/done/',
        views.CustomPasswordResetDoneView.as_view(),
        name='password_reset_done',
    ),
    path(
        'password-reset/<uidb64>/<token>/',
        views.CustomPasswordResetConfirmView.as_view(),
        name='password_reset_confirm',
    ),
    path(
        'password-reset/complete/',
        views.CustomPasswordResetCompleteView.as_view(),
        name='password_reset_complete',
    ),
]
