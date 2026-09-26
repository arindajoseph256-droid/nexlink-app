"""Normalize the effective request scheme behind TLS-terminating proxies.

Some preview/tunneling proxies serve the app over HTTPS but forward it to
Daphne over plain HTTP *without* X-Forwarded-Proto. Django then believes the
request is insecure and rejects browser CSRF origins like
``https://<preview-host>`` ("Origin checking failed" on every login POST).

When the browser-provided Origin/Referer host matches the request Host
exactly (same site) and indicates HTTPS, synthesize ``HTTP_X_FORWARDED_PROTO``
so Django's standard ``SECURE_PROXY_SSL_HEADER`` logic applies.

This is safe: an attacker page's Origin/Referer never matches the served
host, real proxies that DO forward X-Forwarded-Proto are left untouched, and
all other CSRF checks (token, host validation) still run normally.
"""

from urllib.parse import urlsplit

from django.core.exceptions import DisallowedHost


class ProxySchemeFixMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        meta = request.META
        if not meta.get('HTTP_X_FORWARDED_PROTO'):
            try:
                host = request.get_host()
            except DisallowedHost:
                host = None
            if host:
                for header in ('HTTP_ORIGIN', 'HTTP_REFERER'):
                    value = meta.get(header)
                    if not value:
                        continue
                    try:
                        parsed = urlsplit(value)
                    except ValueError:
                        continue
                    if parsed.scheme == 'https' and parsed.netloc == host:
                        meta['HTTP_X_FORWARDED_PROTO'] = 'https'
                        break
        return self.get_response(request)
