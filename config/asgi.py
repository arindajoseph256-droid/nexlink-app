"""
ASGI config for the messaging platform.

Exposes the ASGI callable plus the Channels websocket URL patterns.
"""

import os

from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator
from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

django_asgi_app = get_asgi_application()

from messaging.routing import websocket_urlpatterns  # noqa: E402
from accounts.ws_auth import TokenQueryMiddleware  # noqa: E402

application = ProtocolTypeRouter(
    {
        'http': django_asgi_app,
        'websocket': AllowedHostsOriginValidator(
            AuthMiddlewareStack(
                TokenQueryMiddleware(URLRouter(websocket_urlpatterns))
            )
        ),
    }
)
