"""API URL patterns for the messaging app."""
from django.urls import path

from . import views
from .mobile_version import mobile_version

app_name = 'messaging_api'

urlpatterns = [
    path('mobile/version/', mobile_version, name='mobile_version'),
    path('conversations/', views.ConversationListView.as_view(), name='conversations'),
    path('conversations/start/', views.ConversationCreateView.as_view(), name='conversation_start'),
    path(
        'conversations/<int:conversation_id>/messages/',
        views.MessageListCreateView.as_view(),
        name='messages',
    ),
    path(
        'conversations/<int:conversation_id>/read/',
        views.mark_conversation_read,
        name='mark_read',
    ),
    path('messages/<int:message_id>/react/', views.react_to_message, name='react'),
    path('messages/<int:message_id>/edit/', views.edit_message, name='edit_message'),
    path('messages/<int:message_id>/delete/', views.delete_message, name='delete_message'),
    path('messages/<int:message_id>/delete-for-me/', views.delete_message_for_me, name='delete_message_for_me'),
    path('messages/<int:message_id>/attachment/', views.download_attachment, name='download_attachment'),
    path('users/search/', views.search_users, name='user_search'),
    path('chats/people/', views.chat_people, name='chat_people'),
    path('chats/by-phone/', views.chat_by_phone, name='chat_by_phone'),
    path('search/conversations/', views.search_conversations, name='search_conversations'),
    path('search/messages/', views.search_messages, name='search_messages'),
    path('contacts/', views.contacts, name='contacts'),
    path('contacts/<int:user_id>/', views.remove_contact, name='remove_contact'),
    path('users/<int:user_id>/block/', views.block_user, name='block_user'),
    path('users/<int:user_id>/report/', views.report_user, name='report_user'),
    path('groups/', views.create_group, name='group_create'),
    path('groups/<int:conversation_id>/', views.group_detail, name='group_detail'),
    path('groups/<int:conversation_id>/leave/', views.leave_group, name='group_leave'),
    path('groups/<int:conversation_id>/members/', views.add_group_member, name='group_add_member'),
    path('groups/<int:conversation_id>/members/<int:user_id>/', views.remove_group_member, name='group_remove_member'),
    path('groups/<int:conversation_id>/admins/<int:user_id>/', views.promote_group_admin, name='group_promote_admin'),
    path('conversations/<int:conversation_id>/state/', views.conversation_state, name='conversation_state'),
    path('conversations/<int:conversation_id>/clear/', views.clear_chat, name='clear_chat'),
    path('messages/<int:message_id>/star/', views.message_star, name='message_star'),
    path('messages/<int:message_id>/pin/', views.message_pin, name='message_pin'),
    path('messages/starred/', views.starred_messages, name='starred_messages'),
    path('calls/', views.call_history, name='call_history'),
    path('calls/<int:call_id>/answer/', views.call_answer, name='call_answer'),
    path('calls/<int:call_id>/decline/', views.call_decline, name='call_decline'),
    path('calls/<int:call_id>/end/', views.call_end, name='call_end'),
    path('calls/<int:call_id>/signal/', views.call_signal, name='call_signal'),
    path('conversations/<int:conversation_id>/calls/', views.call_start, name='call_start'),
    path('conversations/<int:conversation_id>/media/', views.conversation_media, name='conversation_media'),
    path('notifications/', views.notification_list, name='notifications'),
    path('notifications/read/', views.notifications_mark_read, name='notifications_read'),
]
