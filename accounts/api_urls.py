"""Authentication endpoints for native clients."""
from django.urls import path

from .api_preferences import avatar_api, me_full_api, preferences_api
from .api_views import login_api, logout_api, register_api, me_api

urlpatterns = [
    path('login/', login_api, name='api_login'),
    path('register/', register_api, name='api_register'),
    path('logout/', logout_api, name='api_logout'),
    path('me/', me_api, name='api_me'),
    path('me/full/', me_full_api, name='api_me_full'),
    path('preferences/', preferences_api, name='api_preferences'),
    path('avatar/', avatar_api, name='api_avatar'),
]