"""Public-page sitemap for search engines.

Only genuinely public, indexable URLs belong here — never auth pages,
the dashboard, API endpoints or anything user-specific.
"""
from django.conf import settings
from django.contrib.sitemaps import Sitemap


class StaticViewSitemap(Sitemap):
    priority = 0.9
    changefreq = 'weekly'
    protocol = 'https'

    def items(self):
        return [
            {'loc': '/', 'priority': 1.0, 'changefreq': 'weekly'},
        ]

    def location(self, item):
        return item['loc']

    def priority(self, item):
        return item.get('priority', self.priority)

    def changefreq(self, item):
        return item.get('changefreq', self.changefreq)


sitemaps = {'static': StaticViewSitemap}
