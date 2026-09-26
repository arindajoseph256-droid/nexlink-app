"""Server-rendered pages for the Nexus dashboard (data comes from the API)."""
import json

from django.contrib.auth.decorators import login_required
from django.shortcuts import redirect, render

from accounts.api_views import _user_payload
from accounts.models import UserPreferences

from .models import Conversation


def _nexus_context(request, initial_conversation_id=None):
    user = request.user
    payload = _user_payload(user)
    payload['username'] = user.username
    prefs = UserPreferences.for_user(user)
    payload['preferences'] = {
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
    return {
        'nexus_me': json.dumps(payload),
        'nexus_initial_conversation_id': (
            json.dumps(initial_conversation_id) if initial_conversation_id else 'null'
        ),
    }


@login_required
def conversations_redirect(request):
    """Root: open the dashboard (optionally deep-linked to one conversation)."""
    raw = request.GET.get('c')
    initial_id = None
    if raw and str(raw).isdigit():
        conversation = Conversation.objects.filter(
            participants__user=request.user, pk=raw,
        ).first()
        if conversation:
            initial_id = conversation.pk
    return render(request, 'messaging/dashboard.html', _nexus_context(request, initial_id))


@login_required
def chat_view(request, conversation_id):
    """Render the dashboard focused on one conversation (legacy /chat/<id>/ URL)."""
    conversation = Conversation.objects.filter(
        participants__user=request.user,
        pk=conversation_id,
    ).first()
    if not conversation:
        return redirect('messaging:conversations')
    return render(
        request, 'messaging/dashboard.html',
        _nexus_context(request, conversation.pk),
    )
