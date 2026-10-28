"""Page URL patterns for the messaging app (server-rendered chat shell)."""
from django.urls import path
from django.views.generic import RedirectView

from . import page_views

app_name = 'messaging'


urlpatterns = [
    path('', page_views.home, name='home'),
    path('chats/', page_views.dashboard, name='conversations'),
    # Friendlier /dashboard/ address for the same chat dashboard: book marks
    # and typed URLs land here instead of a 404.
    path(
        'dashboard/',
        RedirectView.as_view(pattern_name='messaging:conversations', permanent=False),
    ),
    path('chat/<int:conversation_id>/', page_views.chat_view, name='chat'),
]
