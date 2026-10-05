"""Web Push delivery for browsers (Chrome desktop/Android, Edge, Firefox).

Subscriptions are stored in WebPushSubscription (registered by the
service worker + push registration flow on the web client) and messages
are signed with the project's VAPID key pair. The key pair is generated
once on first use and stored in the VapidKey table so every deploy signs
with the same identity — rotating it would invalidate all existing
subscriptions.

Delivery happens in a daemon thread (same pattern as accounts.push) so
request latency is unaffected. Subscriptions the push service reports as
gone (404/410) or as unauthorized (403) are pruned so the registry
self-heals.
"""
import base64
import json
import threading

from django.conf import settings

from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from py_vapid import Vapid
from pywebpush import webpush, WebPushException

from .push_models import VapidKey, WebPushSubscription

VAPID_KEY_NAME = 'default'
# mailto contact embedded in VAPID claims (required by the spec).
VAPID_CONTACT = getattr(settings, 'VAPID_CONTACT_EMAIL', '') or 'mailto:admin@nexlink.app'


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip('=')


def get_vapid() -> Vapid:
    """Load the stored VAPID key pair, generating one on first use.

    Self-heals if the stored PEM is unreadable (e.g. corrupted by an
    earlier bytes-vs-str storage bug) by regenerating the key pair once.
    """
    key_obj, _created = VapidKey.objects.get_or_create(name=VAPID_KEY_NAME)
    vapid = None
    if key_obj.private_pem:
        try:
            vapid = Vapid.from_pem(key_obj.private_pem.encode())
        except Exception:
            vapid = None  # fall through and regenerate
    if vapid is None:
        vapid = Vapid()
        vapid.generate_keys()
        pem = vapid.private_pem()
        key_obj.private_pem = pem.decode() if isinstance(pem, bytes) else pem
        key_obj.save(update_fields=['private_pem'])
    return vapid


def vapid_public_key() -> str:
    """The applicationServerKey browsers need to subscribe (b64url)."""
    vapid = get_vapid()
    raw = vapid.private_key.public_key().public_bytes(
        Encoding.X962, PublicFormat.UncompressedPoint,
    )
    return _b64url(raw)


def send_web_push(user_ids, title, body_text, data=None):
    """Send a Web Push to every browser subscription of the given users.

    Fire-and-forget from the caller's perspective; returns the number of
    subscriptions the message was queued for.
    """
    if not user_ids:
        return 0

    subscriptions = list(
        WebPushSubscription.objects.filter(user_id__in=user_ids)
        .values('id', 'endpoint', 'p256dh', 'auth')
    )
    if not subscriptions:
        return 0

    try:
        vapid = get_vapid()
    except Exception:  # key storage problems must not break message sends
        return 0

    payload = json.dumps({'title': title, 'body': body_text, 'data': data or {}})
    claims = {'sub': VAPID_CONTACT}

    def _dispatch():
        for sub in subscriptions:
            try:
                webpush(
                    subscription_info={
                        'endpoint': sub['endpoint'],
                        'keys': {'p256dh': sub['p256dh'], 'auth': sub['auth']},
                    },
                    data=payload,
                    vapid_private_key=vapid,
                    vapid_claims=claims,
                    timeout=10,
                )
            except WebPushException as exc:
                status_code = getattr(getattr(exc, 'response', None), 'status_code', None)
                if status_code in (404, 410, 403):
                    WebPushSubscription.objects.filter(id=sub['id']).delete()
            except Exception:
                pass  # network hiccup — push is best-effort

    threading.Thread(target=_dispatch, daemon=True).start()
    return len(subscriptions)
