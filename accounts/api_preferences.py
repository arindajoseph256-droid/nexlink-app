"""Accounts API: preferences, avatar upload and richer session profile."""
from rest_framework import permissions, status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from .api_views import _user_payload
from .models import UserPreferences

STATUS_FLOW = {'available', 'busy', 'away', 'dnd', 'invisible'}


def _preferences_payload(prefs):
    return {
        'theme': prefs.theme,
        'accent': prefs.accent,
        'status': prefs.status,
        'enter_to_send': prefs.enter_to_send,
        'notifications': prefs.notifications_enabled,
        'sounds': prefs.sounds_enabled,
        'read_receipts': prefs.read_receipts,
        'typing_indicator': prefs.typing_indicator,
        'last_seen_visible': prefs.last_seen_visible,
    }


@api_view(['GET', 'PATCH'])
@permission_classes([permissions.IsAuthenticated])
def preferences_api(request):
    """Return (or partially update) the signed-in user's synced settings."""
    prefs = UserPreferences.for_user(request.user)
    if request.method == 'GET':
        return Response(_preferences_payload(prefs))

    data = request.data or {}
    if 'theme' in data:
        if data['theme'] in ('light', 'dark', 'system'):
            prefs.theme = data['theme']
    if 'accent' in data:
        accent = str(data['accent'] or '').strip()
        if len(accent) == 7 and accent.startswith('#'):
            prefs.accent = accent
    if 'status' in data:
        if data['status'] in STATUS_FLOW:
            prefs.status = data['status']
            if data['status'] == 'invisible':
                prefs.user.profile.is_online = False
                prefs.user.profile.save(update_fields=['is_online'])
    for field, key in (
        ('enter_to_send', 'enter_to_send'),
        ('notifications_enabled', 'notifications'),
        ('sounds_enabled', 'sounds'),
        ('read_receipts', 'read_receipts'),
        ('typing_indicator', 'typing_indicator'),
        ('last_seen_visible', 'last_seen_visible'),
    ):
        if key in data:
            setattr(prefs, field, bool(data[key]))
    prefs.save()
    return Response(_preferences_payload(prefs))


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def avatar_api(request):
    """Upload/replace the signed-in user's profile picture."""
    upload = request.FILES.get('avatar')
    if upload is None:
        return Response({'detail': 'An image file is required.'}, status=400)
    if upload.size > 5 * 1024 * 1024:
        return Response({'detail': 'Image must be under 5 MB.'}, status=400)
    profile = request.user.profile
    profile.picture = upload
    profile.save(update_fields=['picture'])
    return Response({'status': 'ok', 'avatar_url': profile.avatar_url})


@api_view(['GET', 'PATCH'])
@permission_classes([permissions.IsAuthenticated])
def me_full_api(request):
    """Session-authenticated profile + preferences (read, or PATCH profile)."""
    prefs = UserPreferences.for_user(request.user)
    if request.method == 'PATCH':
        data = request.data or {}
        profile = request.user.profile
        if 'display_name' in data:
            profile.display_name = (str(data['display_name']) or '').strip()[:50]
        if 'about' in data:
            profile.bio = (str(data['about']) or '').strip()[:280]
        if 'first_name' in data:
            request.user.first_name = (str(data['first_name']) or '').strip()[:30]
            request.user.save(update_fields=['first_name'])
        profile.save(update_fields=['display_name', 'bio'])
    payload = _user_payload(request.user)
    payload['username'] = request.user.username
    payload['first_name'] = request.user.first_name
    payload['last_seen'] = (
        request.user.profile.last_seen.isoformat() if request.user.profile.last_seen else None
    )
    payload['is_online'] = request.user.profile.is_online
    payload['preferences'] = _preferences_payload(prefs)
    return Response(payload)
