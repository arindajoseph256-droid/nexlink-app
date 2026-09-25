"""Admin registration for messaging models."""
from django.contrib import admin

from .models import (
    Conversation,
    ConversationParticipant,
    Message,
    MessageReadStatus,
    Notification,
    Reaction,
)


class ConversationParticipantInline(admin.TabularInline):
    model = ConversationParticipant
    extra = 0
    autocomplete_fields = ['user']


class MessageInline(admin.TabularInline):
    model = Message
    extra = 0
    fields = ('sender', 'body', 'state', 'created_at')
    readonly_fields = ('created_at',)
    ordering = ('-created_at',)


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ('id', 'created_at', 'updated_at')
    inlines = [ConversationParticipantInline, MessageInline]


@admin.register(ConversationParticipant)
class ConversationParticipantAdmin(admin.ModelAdmin):
    list_display = ('user', 'conversation', 'joined_at', 'is_hidden')
    list_filter = ('is_hidden',)
    search_fields = ('user__username',)


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ('id', 'sender', 'conversation', 'state', 'is_deleted', 'created_at')
    list_filter = ('state', 'is_deleted')
    search_fields = ('sender__username', 'body')
    date_hierarchy = 'created_at'


@admin.register(MessageReadStatus)
class MessageReadStatusAdmin(admin.ModelAdmin):
    list_display = ('user', 'message', 'read_at')
    search_fields = ('user__username',)


@admin.register(Reaction)
class ReactionAdmin(admin.ModelAdmin):
    list_display = ('user', 'message', 'emoji', 'created_at')
    search_fields = ('user__username',)


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ('recipient', 'kind', 'text', 'is_read', 'created_at')
    list_filter = ('kind', 'is_read')
    search_fields = ('recipient__username', 'text')
