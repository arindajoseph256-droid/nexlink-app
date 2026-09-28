"""URL configuration for the messaging platform."""
from config import health as views
from django.conf import settings
from django.contrib import admin
from django.contrib.sitemaps.views import sitemap
from django.urls import include, path, re_path
from django.views.generic import TemplateView
from django.views.static import serve as static_serve

from config.sitemaps import sitemaps

urlpatterns = [
    path('admin/', admin.site.urls),
    path('health/', views.health, name='health'),
    path('accounts/', include('accounts.urls')),
    path('api/auth/', include('accounts.api_urls')),
    path('api/', include('messaging.urls')),
    path('', include('messaging.page_urls')),
]

# SEO: robots.txt points crawlers at the sitemap; the sitemap lists only
# public, indexable URLs. The sitemap URL is injected into the robots.txt
# template so it always matches SITE_URL.
def _robots_view(request):
    """Serve robots.txt with an environment-aware absolute sitemap URL."""
    from django.shortcuts import render

    return render(
        request, 'robots.txt',
        {'sitemap_url': settings.SITE_URL + '/sitemap.xml'},
        content_type='text/plain',
    )


urlpatterns += [
    re_path(r'^robots\.txt$', _robots_view, name='robots'),
    path('sitemap.xml', sitemap, {'sitemaps': sitemaps}, name='django.contrib.sitemaps.views.sitemap'),
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

# Branded 404 page (used when DEBUG=False).
handler404 = 'messaging.page_views.page_not_found'
