"""Account-status enforcement for the existing auth endpoints.

When the admin panel suspends an account, ``is_active`` is set False and all
sessions + DRF tokens are revoked (``admin_panel.models.apply_active_status``).
``is_active=False`` already blocks every normal Django/DRF login path:

- ModelBackend authentication fails for inactive users.
- DRF TokenAuthentication rejects inactive users (is_active check).
- QueryTokenAuthentication / ws_auth resolve the user and act on is_active.

This module exists for defensive re-checks at any future custom login path,
and for the admin API's own reads, which should surface suspension state.
"""
from admin_panel.models import active_suspension_for


def login_blocked_reason(user):
    """Return a human-readable reason when this account may not sign in."""
    if not getattr(user, 'pk', None):
        return None
    if not user.is_active:
        suspension = active_suspension_for(user)
        if suspension and suspension.kind == suspension.Kind.DEACTIVATION:
            return 'This account has been permanently deactivated by Nexlink moderation.'
        return 'This account is currently suspended by Nexlink moderation.'
    return None
