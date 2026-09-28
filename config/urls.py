"""URL configuration for the messaging platform."""
from config import health as views
from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path
from django.views.static import serve as static_serve

urlpatterns = [
    path('admin/', admin.site.urls),
    path('health/', views.health, name='health'),
    path('accounts/', include('accounts.urls')),
    path('api/auth/', include('accounts.api_urls')),
    path('api/', include('messaging.urls')),
    path('', include('messaging.page_urls')),
]

# Browsers request /favicon.ico by default; serve the brand icon so the
# preview/proxy logs stay clean.
urlpatterns += [
    re_path(
        r'^favicon\.ico$',
        static_serve,
        {'document_root': settings.BASE_DIR / 'static' / 'images', 'path': 'icon.png'},
    ),
    # The service worker MUST be served from the root scope to control pages.
    re_path(
        r'^service-worker\.js$',
        static_serve,
        {'document_root': settings.BASE_DIR / 'static', 'path': 'service-worker.js'},
    ),
]

# Development convenience: serve uploaded media (profile pictures) directly.
if settings.DEBUG:
    urlpatterns += [
        re_path(
            r'^media/(?P<path>.*)$',
            static_serve,
            {'document_root': settings.MEDIA_ROOT},
        ),
    ]
