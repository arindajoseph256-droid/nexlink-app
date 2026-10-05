"""Expo push notification delivery.

Tokens are stored in PushDevice; dispatch happens in a background thread
so request/WebSocket latency is unaffected. No credentials are hardcoded:
EXPO_ACCESS_TOKEN is optional (Expo allows tokenless pushes at lower
rates), and the endpoint can be overridden for tests via
EXPO_PUSH_URL.
"""
import json
import threading

from django.conf import settings

import urllib.request

EXPO_PUSH_URL_DEFAULT = 'https://exp.host/--/api/v2/push/send'


def _push_url():
    return getattr(settings, 'EXPO_PUSH_URL', None) or EXPO_PUSH_URL_DEFAULT


def _send_one(token, payload):
    """POST one message; returns the Expo ticket dict or an error ticket."""
    body = json.dumps(dict(payload, to=token)).encode()
    req = urllib.request.Request(
        _push_url(),
        data=body,
        headers={
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.expo+json',
        },
        method='POST',
    )
    access_token = getattr(settings, 'EXPO_ACCESS_TOKEN', None)
    if access_token:
        req.add_header('Authorization', f'Bearer {access_token}')
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode()).get('data', [])
            return data[0] if data else {'status': 'error', 'message': 'empty response'}
    except Exception as exc:  # network/HTTP failure — push is best-effort
        return {'status': 'error', 'message': str(exc)}


def send_push(user_ids, title, body_text, data=None):
    """Send a push to every registered device of the given users.

    Fire-and-forget from the caller's perspective. Devices whose tokens
    Expo reports as expired are pruned so the registry self-heals.
    Returns the number of devices the message was queued for.
    """
    if not user_ids:
        return 0

    from .push_models import PushDevice

    tokens = list(
        PushDevice.objects.filter(user_id__in=user_ids)
        .values_list('token', flat=True)
    )
    if not tokens:
        return 0

    payload = {
        'title': title,
        'body': body_text,
        'data': data or {},
        'sound': 'default',
    }

    def _dispatch():
        for token in tokens:
            ticket = _send_one(token, payload)
            if ticket.get('status') == 'error':
                details = ticket.get('details') or {}
                if details.get('error') == 'DeviceNotRegistered':
                    PushDevice.objects.filter(token=token).delete()

    threading.Thread(target=_dispatch, daemon=True).start()
    return len(tokens)


def notify_devices(user_ids, title, body_text, data=None):
    """Send a notification to every device of the given users.

    Fans out to both delivery channels:
    - Expo push (Android/iOS APK) via send_push() above;
    - Web Push (browsers/PWA: Chrome desktop + Android Chrome, Firefox,
      Edge — OS notification even with every tab closed) via
      accounts.webpush.send_web_push().

    Callers only need this function: mute/preference filtering stays the
    caller's responsibility, exactly as before.
    """
    queued = send_push(user_ids, title, body_text, data)
    try:
        from .webpush import send_web_push

        queued += send_web_push(user_ids, title, body_text, data)
    except Exception:  # web push must never break the Expo path
        pass
    return queued
