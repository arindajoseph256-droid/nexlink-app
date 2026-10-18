"""Google Contacts discovery: People API read with a user-granted token.

Privacy-first flow:

1. The client (Google Identity Services on web, expo-auth-session on Android)
   asks Google for an access token scoped to ``contacts.readonly`` ONLY.
   No Gmail scope is ever requested and this module never talks to a Gmail
   endpoint — the People API *is* the address book.
2. The client POSTs the token to ``/api/contacts/google/``.
3. The server calls the People API exactly once, extracts identifiers
   (phone numbers + emails — never names), normalizes and matches them
   against registered Nexlink users via the shared discovery service.
4. The token and all raw identifiers are discarded immediately. Nothing
   about the user's Google address book is persisted server-side.
"""
import json
import urllib.error
import urllib.request

from django.conf import settings

from .discovery import MAX_EMAILS, MAX_PHONES, ValidationError, normalize_phone, match_users

GOOGLE_CONTACTS_SCOPE = 'https://www.googleapis.com/auth/contacts.readonly'

PEOPLE_API_URL = (
    'https://people.googleapis.com/v1/people/me/connections'
    '?personFields=phoneNumbers,emailAddresses&pageSize=500'
)

# Defensive caps on what we accept from Google's response.
MAX_CONNECTIONS = 2000


class GoogleContactsError(Exception):
    """User-safe failure while reading Google Contacts."""

    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


def google_client_id():
    """Public OAuth client ID (client IDs are not secrets)."""
    return (getattr(settings, 'GOOGLE_CONTACTS_CLIENT_ID', '') or '').strip()


def google_android_client_id():
    return (getattr(settings, 'GOOGLE_ANDROID_CLIENT_ID', '') or '').strip()


def google_contacts_enabled():
    return bool(google_client_id())


class _GoogleResponse:
    """Minimal context-manager response for the People API call."""

    def __init__(self, payload):
        self._payload = json.dumps(payload).encode('utf-8')

    def read(self):
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def _people_request(access_token):
    return urllib.request.Request(
        PEOPLE_API_URL,
        headers={
            'Authorization': f'Bearer {access_token}',
            'Accept': 'application/json',
        },
    )


def fetch_google_contacts(access_token):
    """Return (phones, emails, connections_read) from the Google address book.

    Raises :class:`GoogleContactsError` with a user-safe message on any
    failure. The access token is used for exactly this one request and is
    never stored, logged or echoed.
    """
    try:
        with urllib.request.urlopen(_people_request(access_token), timeout=15) as response:
            payload = json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise GoogleContactsError(
                'Google authorization expired or was revoked. Connect Google Contacts again.',
                status=401,
            ) from exc
        raise GoogleContactsError('Google Contacts is unavailable right now. Try again.') from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise GoogleContactsError('Could not reach Google Contacts. Try again.') from exc
    except (json.JSONDecodeError, ValueError) as exc:
        raise GoogleContactsError('Google Contacts returned an unexpected response.') from exc

    phones, emails = set(), set()
    connections = payload.get('connections') or []
    for connection in connections[:MAX_CONNECTIONS]:
        for phone in connection.get('phoneNumbers') or []:
            number = (phone.get('value') or '').strip()
            if number and len(number) <= 32:
                phones.add(number)
        for email in connection.get('emailAddresses') or []:
            address = (email.get('value') or '').strip().lower()
            if address and '@' in address and len(address) <= 254:
                emails.add(address)
    return phones, emails, len(connections)


def normalize_google_identifiers(phones, emails):
    """Normalize raw Google numbers/emails into capped E.164 + email sets.

    Google formats numbers liberally ('+256 772 123456', '(415) 555-0100');
    every entry is run through the same normalizer as device contacts.
    Unparseable entries are dropped silently (never echoed).
    """
    normalized_phones = set()
    for raw in phones:
        try:
            normalized_phones |= normalize_phone(raw)
        except ValidationError:
            continue
        if len(normalized_phones) >= MAX_PHONES:
            break
    normalized_emails = {e for e in emails if len(e) <= 254}
    return set(list(normalized_phones)[:MAX_PHONES]), set(list(normalized_emails)[:MAX_EMAILS])
