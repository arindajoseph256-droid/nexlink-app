"""Authentication endpoints for native clients."""
from django.urls import path

from .api_views import login_api, logout_api, register_api, me_api

urlpatterns = [
    path('login/', login_api, name='api_login'),
    path('register/', register_api, name='api_register'),
    path('logout/', logout_api, name='api_logout'),
    path('me/', me_api, name='api_me'),
]