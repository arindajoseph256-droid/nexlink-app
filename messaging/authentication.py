"""DRF authentication for endpoints consumed by native binary fetchers.

React Native's <Image>/<Video> components and download managers cannot attach
an Authorization header, so GET endpoints that stream files accept the DRF
token as a query parameter — the same scheme the WebSocket layer uses
(accounts/ws_auth.py). Browser/web app flows keep using session cookies and
are unaffected.
"""
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.authtoken.models import Token


class QueryTokenAuthentication(BaseAuthentication):
    """?token=<key> → DRF Token user (for file-streaming GET endpoints)."""

    def authenticate(self, request):
        key = (request.query_params.get('token') or '').strip()
        if not key:
            return None  # let other authenticators (session) take over
        return self.authenticate_credentials(key)

    def authenticate_credentials(self, key):
        token = Token.objects.select_related('user').filter(key=key).first()
        user = getattr(token, 'user', None)
        if not user or not user.is_active:
            raise AuthenticationFailed('Invalid or expired token.')
        return (user, token)

    def authenticate_header(self, request):
        # Makes DRF answer unauthenticated requests with 401 (not 403).
        return 'Token realm="nexlink"'
