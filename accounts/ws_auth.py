"""Token query-string authentication for native WebSocket clients."""
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth.models import AnonymousUser
from rest_framework.authtoken.models import Token


class TokenQueryMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        query = parse_qs(scope.get('query_string', b'').decode())
        token_key = (query.get('token') or [None])[0]
        scope['user'] = await self.get_user(token_key)
        return await super().__call__(scope, receive, send)

    @database_sync_to_async
    def get_user(self, token_key):
        if not token_key:
            return AnonymousUser()
        token = Token.objects.select_related('user').filter(key=token_key).first()
        return token.user if token and token.user.is_active else AnonymousUser()