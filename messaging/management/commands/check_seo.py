"""Lightweight SEO self-check: python manage.py check_seo [base_url]"""
from django.core.management.base import BaseCommand
from django.test import Client


class Command(BaseCommand):
    help = 'Check SEO basics: homepage, robots.txt, sitemap.xml, meta tags.'

    def add_arguments(self, parser):
        parser.add_argument('base_url', nargs='?', default=None)

    def handle(self, *args, **options):
        client = Client()
        failures = []
        ok = lambda cond, label: self.stdout.write(
            f'  {"PASS" if cond else "FAIL"}  {label}'
        ) or (cond or failures.append(label))

        self.stdout.write('NEXLINK SEO CHECK')

        # Homepage (anonymous) must be indexable with proper metadata.
        resp = client.get('/', HTTP_HOST='testserver', follow=False)
        ok(resp.status_code == 200, f'homepage returns 200 (got {resp.status_code})')
        html = resp.content.decode()
        ok('<title>Nexlink' in html, 'homepage title contains "Nexlink"')
        ok('name="description"' in html, 'homepage meta description present')
        ok('<h1' in html, 'homepage has exactly the main H1 section')
        ok(html.count('<h1') == 1, 'exactly one H1 on homepage')
        ok('rel="canonical"' in html, 'canonical link present')
        ok('og:title' in html, 'Open Graph title present')
        ok('application/ld+json' in html, 'JSON-LD structured data present')
        ok('noindex' not in html, 'homepage is NOT noindex')

        # robots.txt
        resp = client.get('/robots.txt', HTTP_HOST='testserver')
        ok(resp.status_code == 200, f'robots.txt returns 200 (got {resp.status_code})')
        ok(b'Sitemap:' in resp.content, 'robots.txt references the sitemap')

        # sitemap.xml
        resp = client.get('/sitemap.xml', HTTP_HOST='testserver')
        ok(resp.status_code == 200, f'sitemap.xml returns 200 (got {resp.status_code})')
        ok(b'<urlset' in resp.content, 'sitemap has urlset entries')

        # favicon + manifest
        resp = client.get('/static/images/icon-192.png', HTTP_HOST='testserver')
        ok(resp.status_code == 200, 'icon-192.png served')
        resp = client.get('/static/manifest.json', HTTP_HOST='testserver')
        ok(resp.status_code == 200, 'manifest.json served')

        # dashboard must not leak to crawlers
        from django.contrib.auth import get_user_model
        User = get_user_model()
        user = User.objects.filter(is_active=True).first()
        if user:
            client.force_login(user)
            resp = client.get('/', HTTP_HOST='testserver')
            html = resp.content.decode()
            ok('noindex' in html, 'dashboard (authed /) is noindex')
            client.logout()

        if failures:
            self.stdout.write(self.style.ERROR(f'{len(failures)} check(s) failed:'))
            for f in failures:
                self.stdout.write(self.style.ERROR(f'  - {f}'))
            raise SystemExit(1)
        self.stdout.write(self.style.SUCCESS('ALL SEO CHECKS PASSED'))
