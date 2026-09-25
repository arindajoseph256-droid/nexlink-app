"""URL configuration for the messaging platform."""
from django.conf import settings
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path('admin/', admin.site.urls),
    path('accounts/', include('accounts.urls')),
    path('api/auth/', include('accounts.api_urls')),
    path('api/', include('messaging.urls')),
    path('', include('messaging.page_urls')),
]

