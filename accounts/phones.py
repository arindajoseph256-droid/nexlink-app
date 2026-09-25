"""Phone-number utilities: E.164 normalization and validation via phonenumbers.

All user-facing phone input flows through :func:`normalize_e164` so the
database only ever stores canonical ``+<digits>`` strings. That makes the
unique constraint on ``User.phone_number`` trustworthy for login and search.
"""
import phonenumbers
from django.conf import settings
from django.core.exceptions import ValidationError


def normalize_e164(raw: str, region: str | None = None) -> str:
    """Normalize *raw* input to E.164 (e.g. ``+256712345678``).

    Numbers without a country code are interpreted in *region*
    (settings.DEFAULT_PHONE_REGION by default). Raises ``ValidationError``
    with a user-friendly message when invalid.
    """
    region = region or settings.DEFAULT_PHONE_REGION
    text = (raw or '').strip()
    if not text:
        raise ValidationError('Phone number is required.')

    # Allow spaces, dashes, dots and parentheses as input separators.
    candidate = text
    if not candidate.startswith('+'):
        candidate = phonenumbers.normalize_digits_only(candidate)

    try:
        number = phonenumbers.parse(candidate, region)
    except phonenumbers.NumberParseException as exc:
        raise ValidationError('Enter a valid phone number.') from exc

    if not phonenumbers.is_valid_number(number):
        raise ValidationError('Enter a valid phone number (including country code, e.g. +1 555 010 1234).')

    return phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.E164)


def region_for(raw: str, region: str | None = None) -> str:
    """Return the ISO region detected for a phone number, e.g. 'UG'."""
    region = region or settings.DEFAULT_PHONE_REGION
    try:
        number = phonenumbers.parse((raw or '').strip(), region)
    except phonenumbers.NumberParseException:
        return region
    return phonenumbers.region_code_for_number(number) or region


def mask_e164(e164: str) -> str:
    """Partially mask a phone number for display: +2567****5678."""
    if len(e164) <= 5:
        return e164
    return f'{e164[:5]}****{e164[-4:]}'


def derive_username_from_phone(e164: str) -> str:
    """Create a stable technical username for Django compatibility."""
    base = 'u' + ''.join(ch for ch in e164 if ch.isdigit())
    return base[:150]
