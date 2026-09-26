"""DRF serializers for the messaging API."""
import os

from django.contrib.auth import get_user_model
from rest_framework import serializers

from accounts.models import Profile

from .models import Contact, Conversation, Message, Reaction

User = get_user_model()


class ProfileMiniSerializer(serializers.ModelSerializer):
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = Profile
        fields = ('display_name', 'bio', 'is_online', 'last_seen', 'avatar_url')

    def get_avatar_url(self, obj):
        if obj.photo_visibility == 'nobody':
            return None
        request = self.context.get('request')
        path = f'/accounts/users/{obj.user_id}/avatar/'
        return request.build_absolute_uri(path) if request and obj.picture else (path if obj.picture else None)


class ParticipantSerializer(serializers.Serializer):
    """Lightweight participant representation for conversation payloads."""

    id = serializers.IntegerField(source='user_id')
    display_name = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()
    is_online = serializers.SerializerMethodField()
    last_seen = serializers.SerializerMethodField()

    def get_display_name(self, obj):
        return obj.user.get_display_name()

    def get_avatar_url(self, obj):
        profile = getattr(obj.user, 'profile', None)
        if not profile or not profile.picture or profile.photo_visibility == 'nobody':
            return None
        request = self.context.get('request')
        path = f'/accounts/users/{obj.user_id}/avatar/'
        return request.build_absolute_uri(path) if request else path

    def get_is_online(self, obj):
        profile = getattr(obj.user, 'profile', None)
        return profile.is_online if profile and profile.online_visibility != 'nobody' else False

    def get_last_seen(self, obj):
        profile = getattr(obj.user, 'profile', None)
        if not profile or profile.last_seen_visibility == 'nobody':
            return None
        return profile.last_seen


class MessageSerializer(serializers.ModelSerializer):
    sender = serializers.SerializerMethodField()
    reply_to = serializers.SerializerMethodField()
    reactions = serializers.SerializerMethodField()
    read_by = serializers.SerializerMethodField()
    attachment_url = serializers.SerializerMethodField()
    starred = serializers.SerializerMethodField()
    pinned = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = (
            'id', 'conversation', 'sender', 'message_type', 'body', 'reply_to',
            'attachment',
            'attachment_url', 'attachment_name', 'attachment_size', 'attachment_mime_type',
            'state', 'sent_at', 'delivered_at', 'read_at', 'is_deleted',
            'edited_at', 'created_at', 'reactions', 'read_by', 'starred', 'pinned',
        )
        read_only_fields = ('id', 'conversation', 'sender', 'state', 'is_deleted',
                            'sent_at', 'delivered_at', 'read_at', 'edited_at', 'created_at',
                            'attachment_name', 'attachment_size', 'attachment_mime_type')
        extra_kwargs = {
            'body': {'max_length': 4000, 'allow_blank': True,
                     'required': False, 'trim_whitespace': True},
            'attachment': {'write_only': True, 'required': False},
        }

    def validate(self, attrs):
        body = (attrs.get('body') or '').strip()
        attachment = attrs.get('attachment')
        message_type = attrs.get('message_type', Message.Type.TEXT)
        if not body and not attachment:
            raise serializers.ValidationError('A message needs text or an attachment.')
        if message_type == Message.Type.TEXT and attachment:
            raise serializers.ValidationError({'message_type': 'Text messages cannot contain attachments.'})
        if attachment:
            if attachment.size > 25 * 1024 * 1024:
                raise serializers.ValidationError({'attachment': 'File too large (maximum 25 MB).'})
            extension = os.path.splitext(attachment.name)[1].lower()
            allowed_extensions = {
                Message.Type.IMAGE: {'.jpg', '.jpeg', '.png', '.gif', '.webp'},
                Message.Type.VIDEO: {'.mp4', '.mov', '.webm'},
                Message.Type.AUDIO: {'.mp3', '.wav', '.ogg', '.m4a', '.webm', '.aac'},
                Message.Type.FILE: {'.pdf', '.txt', '.doc', '.docx', '.xls', '.xlsx', '.zip'},
            }
            if message_type not in allowed_extensions or extension not in allowed_extensions[message_type]:
                raise serializers.ValidationError({'attachment': 'Unsupported file type for this message.'})
        attrs['body'] = body
        return attrs

    def create(self, validated_data):
        attachment = validated_data.get('attachment')
        if attachment:
            validated_data.update({
                'attachment_name': os.path.basename(attachment.name),
                'attachment_size': attachment.size,
                'attachment_mime_type': getattr(attachment, 'content_type', '') or '',
            })
        return super().create(validated_data)

    def get_sender(self, obj):
        profile = getattr(obj.sender, 'profile', None)
        return {
            'id': obj.sender_id,
            'display_name': obj.sender.get_display_name(),
            'avatar_url': profile.avatar_url if profile else None,
        }

    def get_attachment_url(self, obj):
        if not obj.attachment:
            return None
        request = self.context.get('request')
        path = f'/api/messages/{obj.pk}/attachment/'
        return request.build_absolute_uri(path) if request else path

    def get_reply_to(self, obj):
        if not obj.reply_to_id:
            return None
        parent = obj.reply_to
        return {
            'id': parent.id,
            'sender_name': parent.sender.get_display_name(),
            'body': '' if parent.is_deleted else parent.body[:120],
            'is_deleted': parent.is_deleted,
        }

    def get_reactions(self, obj):
        grouped = {}
        for reaction in obj.reactions.all():
            info = grouped.setdefault(
                reaction.emoji, {'emoji': reaction.emoji, 'count': 0, 'users': []},
            )
            info['count'] += 1
            info['users'].append(reaction.user_id)
        return list(grouped.values())

    def get_read_by(self, obj):
        return list(obj.read_statuses.values_list('user_id', flat=True))

    def _viewer_state(self, obj):
        request = self.context.get('request')
        if not request or not getattr(request, 'user', None) or not request.user.is_authenticated:
            return None
        states = getattr(obj, 'viewer_states', None)
        if states is not None:
            return states[0] if states else None
        return obj.user_states.filter(user=request.user).first()

    def get_starred(self, obj):
        state = self._viewer_state(obj)
        return bool(state and state.is_starred)

    def get_pinned(self, obj):
        state = self._viewer_state(obj)
        return bool(state and state.is_pinned)


class ConversationSerializer(serializers.ModelSerializer):
    """Conversation list item: participants, last message, unread count."""

    participants = ParticipantSerializer(source='participants_list', many=True, read_only=True)
    last_message = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()
    pinned = serializers.SerializerMethodField()
    muted = serializers.SerializerMethodField()
    archived = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = (
            'id', 'kind', 'name', 'description', 'participants', 'last_message', 'unread_count',
            'pinned', 'muted', 'archived',
            'updated_at', 'created_at',
        )

    def _viewer_participant(self, obj):
        return getattr(obj, 'viewer_participant', None)

    def get_pinned(self, obj):
        participant = self._viewer_participant(obj)
        return bool(participant and participant.is_pinned)

    def get_muted(self, obj):
        participant = self._viewer_participant(obj)
        return bool(participant and participant.is_muted)

    def get_archived(self, obj):
        participant = self._viewer_participant(obj)
        return bool(participant and participant.is_archived)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # `context` is set by DRF after __init__, so resolve the viewer lazily
        # in get_unread_count() via self.context instead of storing it here.

    def get_last_message(self, obj):
        message = getattr(obj, 'last_message_cached', None)
        if message is None:
            return None
        return {
            'id': message.id,
            'sender_id': message.sender_id,
            'body': '' if message.is_deleted else message.body[:120],
            'is_deleted': message.is_deleted,
            'created_at': message.created_at,
        }

    def get_unread_count(self, obj):
        viewer = self.context.get('request').user if self.context.get('request') else None
        if not viewer:
            return 0
        participant = obj.participant_for(viewer)
        if not participant:
            return 0
        if not participant.last_read_message_id:
            return (
                obj.messages.filter(is_deleted=False)
                .exclude(sender=viewer)
                .count()
            )
        last_read = participant.last_read_message
        return (
            obj.messages
            .filter(is_deleted=False)
            .exclude(sender=viewer)
            .filter(created_at__gt=last_read.created_at)
            .count()
        )


class UserSearchSerializer(serializers.ModelSerializer):
    """Public shape of a user for search results and contact lists.

    Deliberately excludes email, phone number, and activity metadata: the
    phone number is an identity/search key, not something to spray across
    the UI. Callers who need a full profile use the profile endpoint.
    """

    display_name = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()
    about = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ('id', 'display_name', 'about', 'avatar_url')

    def get_display_name(self, obj):
        return obj.get_display_name()

    def get_avatar_url(self, obj):
        profile = getattr(obj, 'profile', None)
        if not profile or not profile.picture or profile.photo_visibility == 'nobody':
            return None
        request = self.context.get('request')
        path = f'/accounts/users/{obj.pk}/avatar/'
        return request.build_absolute_uri(path) if request else path

    def get_about(self, obj):
        profile = getattr(obj, 'profile', None)
        return profile.bio if profile and profile.about_visibility != 'nobody' else ''


class ReactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Reaction
        fields = ('id', 'message', 'emoji', 'user')
        read_only_fields = ('user',)


class ChatPeopleSerializer(serializers.ModelSerializer):
    """A user you have chatted with: name plus masked phone as sub-line."""

    display_name = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()
    masked_phone = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ('id', 'display_name', 'masked_phone', 'avatar_url')

    def get_display_name(self, obj):
        return obj.get_display_name()

    def get_avatar_url(self, obj):
        profile = getattr(obj, 'profile', None)
        if not profile or not profile.picture or profile.photo_visibility == 'nobody':
            return None
        request = self.context.get('request')
        path = f'/accounts/users/{obj.pk}/avatar/'
        return request.build_absolute_uri(path) if request else path


class ContactSerializer(serializers.ModelSerializer):
    contact_id = serializers.IntegerField(read_only=True)
    display_name = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = Contact
        fields = ('id', 'contact_id', 'display_name', 'avatar_url', 'nickname', 'created_at')
        read_only_fields = ('id', 'contact_id', 'display_name', 'avatar_url', 'created_at')

    def get_display_name(self, obj):
        return obj.contact.get_display_name()

    def get_avatar_url(self, obj):
        profile = getattr(obj.contact, 'profile', None)
        return profile.avatar_url if profile else None
