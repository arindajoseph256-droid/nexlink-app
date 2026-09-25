"""Page URL patterns for the messaging app (server-rendered chat shell)."""
from django.urls import path

from . import page_views

app_name = 'messaging'


urlpatterns = [
    path('', page_views.conversations_redirect, name='conversations'),
    path('chat/<int:conversation_id>/', page_views.chat_view, name='chat'),
]
