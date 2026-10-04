"""Authentication endpoints for native clients."""
from django.urls import path

from .api_preferences import avatar_api, me_full_api, preferences_api
from .api_views import (
    backup_api,
    backup_email_api,
    email_change_api,
    login_api,
    logout_api,
    me_api,
    password_change_api,
    push_register_api,
    push_unregister_api,
    register_api,
)

urlpatterns = [
    path('login/', login_api, name='api_login'),
    path('register/', register_api, name='api_register'),
    path('logout/', logout_api, name='api_logout'),
    path('me/', me_api, name='api_me'),
    path('me/full/', me_full_api, name='api_me_full'),
    path('preferences/', preferences_api, name='api_preferences'),
    path('avatar/', avatar_api, name='api_avatar'),
    path('password-change/', password_change_api, name='api_password_change'),
    path('email-change/', email_change_api, name='api_email_change'),
    path('backup/', backup_api, name='api_backup'),
    path('backup/email/', backup_email_api, name='api_backup_email'),
    path('push/register/', push_register_api, name='api_push_register'),
    path('push/unregister/', push_unregister_api, name='api_push_unregister'),
]