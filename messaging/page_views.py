"""Server-rendered pages for the chat UI (the shell; data comes from the API)."""
from django.contrib.auth.decorators import login_required
from django.shortcuts import redirect, render

from .models import Conversation


@login_required
def conversations_redirect(request):
    """Root: open the most recent conversation, else show empty state page."""
    participant = (
        request.user.conversation_memberships
        .select_related('conversation')
        .order_by('-conversation__updated_at')
        .first()
    )
    if participant:
        return redirect('messaging:chat', conversation_id=participant.conversation_id)
    return render(request, 'messaging/conversations.html', {'active_conversation': None})


@login_required
def chat_view(request, conversation_id):
    """Render the chat shell for one conversation (client fetches messages)."""
    conversation = Conversation.objects.filter(
        participants__user=request.user,
        pk=conversation_id,
    ).first()
    if not conversation:
        return redirect('messaging:conversations')
    return render(request, 'messaging/chat.html', {
        'active_conversation': conversation,
    })
