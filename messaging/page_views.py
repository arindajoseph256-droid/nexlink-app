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


def home(request):
    """Root page: public SEO landing for visitors, dashboard for users."""
    if request.user.is_authenticated:
        return dashboard(request)
    from config.seo import home_meta

    context = home_meta(request)
    return render(request, 'public/home.html', context)


@login_required
def dashboard(request, initial_conversation_id=None):
    """Authenticated chat dashboard (private — never indexed)."""
    raw = request.GET.get('c')
    initial_id = initial_conversation_id
    if raw and str(raw).isdigit():
        conversation = Conversation.objects.filter(
            participants__user=request.user, pk=raw,
        ).first()
        if conversation:
            initial_id = conversation.pk
    context = _nexus_context(request, initial_id)
    context['seo_noindex'] = True
    return render(request, 'messaging/dashboard.html', context)


def conversations_redirect(request):
    """Backwards-compatible alias for the authenticated dashboard."""
    return dashboard(request)


@login_required
def chat_view(request, conversation_id):
    """Render the dashboard focused on one conversation (legacy /chat/<id>/ URL)."""
    conversation = Conversation.objects.filter(
        participants__user=request.user,
        pk=conversation_id,
    ).first()
    if not conversation:
        return redirect('messaging:conversations')
    return dashboard(request, conversation.pk)


def page_not_found(request, exception=None):
    """Branded 404 page (registered as handler404 in config/urls.py)."""
    return render(request, '404.html', status=404)
