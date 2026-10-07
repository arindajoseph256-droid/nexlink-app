"""Contact discovery: normalization, matching and People-You-May-Know ranking.

Privacy rules are enforced here, in one place:

- Uploaded identifiers are used for matching only. They are never stored and
  never echoed back; the response contains the matched *Nexlink user* with
  safe fields (id, display name, avatar path, relationship counts) only.
- A matched person's phone number or email address is never returned.
- Blocking always wins: a candidate is filtered out when either side has
  blocked the other (same rule as ``search_users`` and conversation start).
- Discoverability flags on the candidate's ``Profile`` gate each source
  (phone / email / suggestions) independently.

No contact names are accepted or stored — the service only ever sees
normalized phone/email identifiers, so nothing about the uploader's private
address book persists on the server.
"""
import phonenumbers
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import EmailValidator

from accounts.models import Profile

from .models import BlockedUser, Contact, Conversation, ConversationParticipant

# Payload limits (abuse / enumeration protection — see requirement 25).
MAX_PHONES = 200
MAX_EMAILS = 200
MAX_ITEM_LENGTH = 32
MAX_SUGGESTION_CANDIDATES = 80
MAX_RESULTS = 50

VALID_SOURCES = {'phone_contacts', 'email_contacts', 'google_contacts'}

_email_validator = EmailValidator()


# --------------------------------------------------------------------------
# Normalization
# --------------------------------------------------------------------------

def _digits(text):
    return ''.join(ch for ch in (text or '') if ch.isdigit())


def normalize_phone(raw, region=None):
    """Return the set of plausible E.164 forms for one contact-book number.

    Contact books store numbers in mixed formats ('0772123456',
    '+256772123456', '256 772 123 456'). Like the existing ``search_users``
    phone path, we try every reasonable reading instead of guessing:

    1. as typed (local number interpreted in *region*)
    2. digits prefixed with '+' (international number missing the plus)
    3. digits alone (local number in *region*)

    Raises ``ValidationError`` when no reading is a valid phone number.
    """
    region = region or settings.DEFAULT_PHONE_REGION
    text = (raw or '').strip()
    if not text:
        raise ValidationError('Empty phone number.')
    if len(text) > MAX_ITEM_LENGTH:
        raise ValidationError('Phone number too long.')

    digits = _digits(text)
    candidates = [text, '+' + digits, digits] if digits else [text]

    found = set()
    for candidate in candidates:
        try:
            number = phonenumbers.parse(candidate, region)
        except phonenumbers.NumberParseException:
            continue
        if phonenumbers.is_valid_number(number):
            found.add(phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.E164))
    if not found:
        raise ValidationError('Not a valid phone number.')
    return found


def normalize_email(raw):
    """Lowercase/validate one email. Raises ``ValidationError`` when invalid."""
    value = (raw or '').strip().lower()
    if not value or len(value) > 254:
        raise ValidationError('Invalid email address.')
    _email_validator(value)
    return value


def collect_identifiers(payload):
    """Extract bounded {phones, emails} sets from a match-request payload.

    Malformed items are counted (never echoed). Raises ``ValueError`` when
    the payload is structurally wrong or exceeds the size limits.
    """
    if not isinstance(payload, dict):
        raise ValueError('Payload must be a JSON object.')

    phones_raw = payload.get('phones', [])
    emails_raw = payload.get('emails', [])
    if not isinstance(phones_raw, list) or not isinstance(emails_raw, list):
        raise ValueError("'phones' and 'emails' must be arrays.")

    if len(phones_raw) > MAX_PHONES or len(emails_raw) > MAX_EMAILS:
        raise ValueError('Too many identifiers in one request.')

    phones, emails, rejected = set(), set(), 0
    for item in phones_raw:
        if not isinstance(item, str) or len(item) > MAX_ITEM_LENGTH:
            rejected += 1
            continue
        try:
            phones |= normalize_phone(item)
        except ValidationError:
            rejected += 1
    for item in emails_raw:
        if not isinstance(item, str) or len(item) > 254:
            rejected += 1
            continue
        try:
            emails.add(normalize_email(item))
        except ValidationError:
            rejected += 1

    if not phones and not emails:
        if rejected:
            raise ValueError('No usable identifiers in payload.')
        return {'phones': set(), 'emails': set(), 'rejected': 0}
    return {'phones': phones, 'emails': emails, 'rejected': rejected}


# --------------------------------------------------------------------------
# Safety filters (shared by every source)
# --------------------------------------------------------------------------

def blocked_ids_for(user):
    """IDs the viewer may not see, either direction of blocking."""
    pairs = BlockedUser.objects.filter(
        blocker=user,
    ).values_list('blocked_id', flat=True)
    reverse = BlockedUser.objects.filter(
        blocked=user,
    ).values_list('blocker_id', flat=True)
    return set(pairs) | set(reverse)


def _suggestion_allowed(user_id, profile_map):
    profile = profile_map.get(user_id)
    return bool(profile is None or profile.discoverable_in_suggestions)


def _profile_map(user_ids):
    profiles = Profile.objects.filter(user_id__in=user_ids)
    return {profile.user_id: profile for profile in profiles}


def _avatar_url(profile, request):
    if not profile or not profile.picture or profile.photo_visibility == 'nobody':
        return None
    path = f'/accounts/users/{profile.user_id}/avatar/'
    return request.build_absolute_uri(path) if request else path


def _result(user, profile, request, source, sources, mutual_contacts=0, shared_groups=0, is_contact=False):
    return {
        'id': user.pk,
        'display_name': user.get_display_name(),
        'avatar_url': _avatar_url(profile, request),
        'source': source,
        'sources': sorted(sources),
        'mutual_contacts': mutual_contacts,
        'shared_groups': shared_groups,
        'can_message': True,  # blocked users are filtered out before this point
        'is_contact': is_contact,
    }


# --------------------------------------------------------------------------
# Contact matching (phone / email / Google Contacts identifiers)
# --------------------------------------------------------------------------

def _match_query(phones, emails):
    """Build a User queryset filter for normalized identifiers.

    Exact E.164 matches are primary. For numbers that could only be resolved
    as digit strings (country code unknown server-side), a suffix match on
    the stored E.164 number covers the '+256…' stored form of '0772…'.
    """
    from django.db.models import Q

    from accounts.models import User  # noqa: PLC0415 (avoids app-loading order issues in migrations)

    e164 = {p for p in phones if p.startswith('+') and len(p) > 9}
    bare = {p for p in phones if not (p.startswith('+') and len(p) > 9)}
    condition = Q()
    if e164:
        condition |= Q(phone_number__in=e164)
    if bare:
        # '0772123456' → match the tail of stored '+256772123456'.
        suffixes = {digits[-9:] for digits in (_digits(p) for p in bare) if len(digits) >= 9}
        for suffix in suffixes:
            condition |= Q(phone_number__endswith=suffix)
    if emails:
        condition |= Q(email__in=emails)
    if condition == Q():
        return User.objects.none()
    return User.objects.filter(condition).filter(is_active=True)


def match_users(owner, phones=None, emails=None, source='phone_contacts', request=None):
    """Match uploaded identifiers against registered Nexlink accounts.

    Returns safe result dicts sorted by (contact first, mutuals, name).
    The uploader never appears in their own results; blocked users and
    candidates who disabled the relevant discoverability flag are excluded.
    """
    if source not in VALID_SOURCES:
        raise ValueError('Unknown discovery source.')
    phones = {p for p in (phones or []) if p}
    emails = {(e or '').strip().lower() for e in (emails or []) if e}
    if not phones and not emails:
        return []

    blocked = blocked_ids_for(owner)
    candidates = _match_query(phones, emails).exclude(pk__in={owner.pk, *blocked})
    candidates = candidates.select_related('profile')[: MAX_PHONES + MAX_EMAILS]

    contact_ids = set(
        Contact.objects.filter(owner=owner).values_list('contact_id', flat=True),
    )
    mutual_counts = _mutual_counts(owner, [c.pk for c in candidates], cap=MAX_RESULTS)
    shared_groups = _shared_group_counts(owner, [c.pk for c in candidates])

    owner_email = (owner.email or '').lower()

    results = []
    for user in candidates:
        profile = user.profile
        if phones:
            phone_match = (
                (user.phone_number or '') in phones
                or any((user.phone_number or '').endswith(_digits(p)[-9:])
                       for p in phones if len(_digits(p)) >= 9)
            )
            if phone_match and not profile.discoverable_by_phone:
                continue
        if emails:
            email_match = bool(user.email) and user.email.lower() in emails
            if email_match and not profile.discoverable_by_email:
                continue
        if owner_email and user.email and user.email.lower() == owner_email:
            # Never surface your own account via your own identifiers.
            continue

        sources = set()
        if emails and user.email and user.email.lower() in emails:
            sources.add('email')
        if any((user.phone_number or '').endswith(_digits(p)[-9:]) or (user.phone_number or '') in phones
               for p in phones if p):
            sources.add('phone')
        if not sources:
            continue

        results.append(_result(
            user, profile, request,
            source=source,
            sources=sources,
            mutual_contacts=mutual_counts.get(user.pk, 0),
            shared_groups=shared_groups.get(user.pk, 0),
            is_contact=user.pk in contact_ids,
        ))

    results.sort(key=lambda r: (not r['is_contact'], -r['mutual_contacts'], r['display_name'].lower()))
    return results[:MAX_RESULTS]


# --------------------------------------------------------------------------
# People You May Know (relationship signals only — nothing random)
# --------------------------------------------------------------------------

def _mutual_counts(owner, candidate_ids, cap):
    """How many of the owner's contacts each candidate also lists.

    mutual(A, X) = |contacts(A) ∩ contacts(X)| computed from real Contact
    rows; never fabricated.
    """
    owner_contact_ids = list(
        Contact.objects.filter(owner=owner).values_list('contact_id', flat=True)[:200],
    )
    if not owner_contact_ids or not candidate_ids:
        return {}
    counts = (
        Contact.objects
        .filter(owner_id__in=candidate_ids, contact_id__in=owner_contact_ids)
        .values_list('owner_id', 'contact_id')
    )
    result = {}
    for owner_id, _contact_id in counts:
        result[owner_id] = result.get(owner_id, 0) + 1
    return result


def _shared_group_counts(owner, candidate_ids):
    if not candidate_ids:
        return {}
    my_groups = list(
        ConversationParticipant.objects.filter(
            user=owner, conversation__kind=Conversation.Kind.GROUP,
        ).values_list('conversation_id', flat=True)[:100],
    )
    if not my_groups:
        return {}
    counts = (
        ConversationParticipant.objects
        .filter(conversation_id__in=my_groups, user_id__in=candidate_ids)
        .values_list('user_id', 'conversation_id')
    )
    result = {}
    for user_id, _conversation_id in counts:
        result[user_id] = result.get(user_id, 0) + 1
    return result


def _dm_peer_ids(owner):
    dm_ids = list(
        ConversationParticipant.objects.filter(
            user=owner, conversation__kind=Conversation.Kind.DM,
        ).values_list('conversation_id', flat=True)[:100],
    )
    if not dm_ids:
        return set()
    return set(
        ConversationParticipant.objects
        .filter(conversation_id__in=dm_ids)
        .exclude(user=owner)
        .values_list('user_id', flat=True),
    )


def suggestions_for(owner, request=None, limit=20):
    """Ranked 'People You May Know' from real relationship signals.

    Candidate pool (all from the live database):
      - the owner's saved contacts,
      - peers from existing direct conversations,
      - co-members of shared groups.

    Ranking priority:
      P1 saved contact        P2 mutual contacts (desc)
      P3 shared groups (desc) P4 existing DM history
    A future follow/friend system slots in as an extra candidate pool +
    ranking key without changing this contract.
    """
    limit = max(1, min(int(limit or 20), MAX_RESULTS))

    contact_rows = list(
        Contact.objects.filter(owner=owner).values_list('contact_id', flat=True)[:200],
    )
    dm_peers = _dm_peer_ids(owner)
    group_peer_ids = list(
        ConversationParticipant.objects
        .filter(
            conversation__kind=Conversation.Kind.GROUP,
            conversation__participants__user=owner,
        )
        .exclude(user=owner)
        .values_list('user_id', flat=True)[:200],
    )

    candidate_ids = set(contact_rows) | dm_peers | set(group_peer_ids)
    candidate_ids.discard(owner.pk)
    blocked = blocked_ids_for(owner)
    candidate_ids -= blocked
    candidate_ids = list(candidate_ids)[:MAX_SUGGESTION_CANDIDATES]
    if not candidate_ids:
        return []

    users = {
        user.pk: user
        for user in type(owner).objects.filter(pk__in=candidate_ids, is_active=True).select_related('profile')
    }
    profile_map = _profile_map(candidate_ids)
    mutual_counts = _mutual_counts(owner, list(users), cap=limit)
    shared_groups = _shared_group_counts(owner, list(users))
    contact_set = set(contact_rows)

    results = []
    for user_id, user in users.items():
        if not _suggestion_allowed(user_id, profile_map):
            continue
        results.append(_result(
            user,
            profile_map.get(user_id),
            request,
            source='nexlink',
            sources=['nexlink'],
            mutual_contacts=mutual_counts.get(user_id, 0),
            shared_groups=shared_groups.get(user_id, 0),
            is_contact=user_id in contact_set,
        ))

    results.sort(key=lambda r: (
        not r['is_contact'],
        -r['mutual_contacts'],
        -r['shared_groups'],
        r['display_name'].lower(),
    ))
    return results[:limit]
