"""Mobile app version/update configuration endpoint.

Additive endpoint for the Nexlink Android client: it compares the installed
app version against the latest released version so installed APKs can tell
users a new binary is available (OTA/Expo Update handles JS-only changes;
this endpoint handles everything that requires a new APK).

The configuration lives in the MOBILE_VERSIONS Django setting so the release
flow stays server-side: bumping "latest_version" here reaches every installed
app without shipping a new client.
"""
from django.conf import settings
from rest_framework import permissions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response


def _default_config():
    fallback = getattr(settings, 'MOBILE_VERSIONS', None) or {}
    return {
        'latest_version': fallback.get('latest_version', '1.3.0'),
        'minimum_supported_version': fallback.get('minimum_supported_version', '1.0.0'),
        'update_required': fallback.get('update_required', False),
        'download_url': fallback.get('download_url', ''),
        'release_notes': fallback.get('release_notes', ''),
        'platform': 'android',
    }


def _version_tuple(value):
    """'1.2.3' -> (1, 2, 3); non-numeric parts are dropped defensively."""
    parts = []
    for chunk in str(value or '').strip().split('.'):
        digits = ''.join(c for c in chunk if c.isdigit())
        if not digits:
            break
        parts.append(int(digits))
    return tuple(parts or [0])


def _version_gte(installed, minimum):
    a, b = _version_tuple(installed), _version_tuple(minimum)
    length = max(len(a), len(b))
    a += (0,) * (length - len(a))
    b += (0,) * (length - len(b))
    return a >= b


@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def mobile_version(request):
    """Public version check for the Android client (no auth: runs pre-login)."""
    installed = (request.query_params.get('version') or '').strip()
    config = _default_config()
    update_required = config['update_required'] or (
        installed
        and config['minimum_supported_version']
        and not _version_gte(installed, config['minimum_supported_version'])
    )
    has_update = bool(
        installed
        and config['latest_version']
        and not _version_gte(installed, config['latest_version'])
    )
    return Response({
        **config,
        'installed_version': installed or None,
        'update_available': has_update,
        'update_required': bool(update_required),
    })
