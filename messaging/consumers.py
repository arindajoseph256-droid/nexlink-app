"""WebSocket consumers for realtime messaging, typing and presence."""
import json
from datetime import timedelta

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.utils import timezone

USER_ROOM = 'user-{user_id}'


class NotificationConsumer(AsyncJsonWebsocketConsumer):
    """Per-user socket: unread badges / conversation updates while no chat
    pane is open, so the sidebar stays fresh everywhere."""

    async def connect(self):
        self.user = self.scope['user']
        # Custom close codes are unreliable across ASGI servers pre-accept,
        # so rejections use the standard code; clients detect rejection by
        # the close arriving before any 'connected' greeting.
        if not self.user.is_authenticated:
            await self.close()
            return

        self.room_name = USER_ROOM.format(user_id=self.user.id)
        await self.channel_layer.group_add(self.room_name, self.channel_name)
        await self.accept()
        await self.send_json({'type': 'connected'})

    async def disconnect(self, code):
        if hasattr(self, 'room_name'):
            await self.channel_layer.group_discard(self.room_name, self.channel_name)

    async def receive_json(self, content, **kwargs):
        if content.get('type') == 'presence.ping':
            await self.set_presence_online()

    # Group event handlers

    async def conversation_new(self, event):
        await self.send(text_data=json.dumps(event))

    async def notification_event(self, event):
        await self.send(text_data=json.dumps(event))

    async def call_incoming(self, event):
        # The caller must not hear their own ring.
        if event.get('caller_id') != self.user.id:
            await self.send(text_data=json.dumps(event))

    async def call_accepted(self, event):
        await self.send(text_data=json.dumps(event))

    async def call_ended(self, event):
        await self.send(text_data=json.dumps(event))

    @database_sync_to_async
    def set_presence_online(self):
        from accounts.models import Profile
        Profile.objects.filter(user=self.user).update(
            is_online=True, last_seen=timezone.now(),
        )


class ChatConsumer(AsyncJsonWebsocketConsumer):
    """
    Per-conversation socket.

    Connect: /ws/chat/<conversation_id>/
    Events in:  typing, read, presence.ping
    Events out: message.new, message.edited, message.deleted,
                message.read, typing, reaction.updated, presence,
                conversation.new, notification
    """

    async def connect(self):
        self.user = self.scope['user']
        self.conversation_id = self.scope['url_route']['kwargs']['conversation_id']

        # Custom close codes are unreliable across ASGI servers pre-accept,
        # so rejections use the standard code; clients detect rejection by
        # the close arriving before any 'connected' greeting.
        if not self.user.is_authenticated:
            await self.close()
            return

        is_member = await self.user_is_participant()
        if not is_member:
            await self.close()
            return

        await self.accept()

        self.group_name = f'chat-{self.conversation_id}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)

        # Announce presence to other participants.
        await self.set_presence(True)
        await self.channel_layer.group_send(
            self.group_name,
            {
                'type': 'presence.event',
                'user_id': self.user.id,
                'is_online': True,
                'last_seen': None,
            },
        )
        await self.send_json({'type': 'connected', 'conversation_id': self.conversation_id})

    async def disconnect(self, code):
        if hasattr(self, 'group_name'):
            await self.set_presence(False)
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
            await self.channel_layer.group_send(
                self.group_name,
                {
                    'type': 'presence.event',
                    'user_id': self.user.id,
                    'is_online': False,
                    'last_seen': timezone.now().isoformat(),
                },
            )

    # ---------- Incoming client events ----------

    async def receive_json(self, content, **kwargs):
        event = content.get('type')

        if event == 'typing':
            await self.channel_layer.group_send(
                self.group_name,
                {
                    'type': 'typing.event',
                    'user_id': self.user.id,
                    'display_name': self.user.get_display_name(),
                    'is_typing': bool(content.get('is_typing')),
                },
            )
        elif event == 'read':
            latest_id = content.get('message_id')
            updated = await self.mark_read(latest_id)
            if updated:
                await self.channel_layer.group_send(
                    self.group_name,
                    {'type': 'read.event', 'user_id': self.user.id, 'message_id': updated},
                )
        elif event == 'presence.ping':
            await self.set_presence(True)
        else:
            await self.send_json({'type': 'error', 'detail': f'Unknown event: {event}'})

    # ---------- Group event handlers (type: X.y -> handler X_y) ----------

    async def message_new(self, event):
        await self.send(text_data=json.dumps(event))

    async def message_edited(self, event):
        await self.send(text_data=json.dumps(event))

    async def message_deleted(self, event):
        await self.send(text_data=json.dumps(event))

    async def message_read(self, event):
        await self.send(text_data=json.dumps(event))

    async def typing_event(self, event):
        if event['user_id'] != self.user.id:
            await self.send(text_data=json.dumps(event))

    async def read_event(self, event):
        await self.send(text_data=json.dumps(event))

    async def presence_event(self, event):
        if event['user_id'] != self.user.id:
            await self.send(text_data=json.dumps(event))

    async def reaction_updated(self, event):
        await self.send(text_data=json.dumps(event))

    async def conversation_new(self, event):
        await self.send(text_data=json.dumps(event))

    async def notification_event(self, event):
        await self.send(text_data=json.dumps(event))

    async def call_incoming(self, event):
        if event.get('caller_id') != self.user.id:
            await self.send(text_data=json.dumps(event))

    async def call_accepted(self, event):
        await self.send(text_data=json.dumps(event))

    async def call_ended(self, event):
        await self.send(text_data=json.dumps(event))

    async def call_signal(self, event):
        # WebRTC SDP/ICE is only useful to the peer, not the sender.
        if event.get('from_id') != self.user.id:
            await self.send(text_data=json.dumps(event))

    # ---------- Database helpers ----------

    @database_sync_to_async
    def user_is_participant(self):
        from .models import Conversation
        return Conversation.objects.filter(
            pk=self.conversation_id,
            participants__user=self.user,
        ).exists()

    @database_sync_to_async
    def set_presence(self, is_online):
        from accounts.models import Profile
        now = timezone.now()
        Profile.objects.filter(user=self.user).update(
            is_online=is_online,
            last_seen=now,
        )
        # Self-healing: a stale online row (client killed without a graceful
        # disconnect) would suppress Expo push forever. Auto-offline users
        # whose last heartbeat is too old; actively connected sockets ping
        # every ~45s, so 2 minutes is a safe threshold.
        if is_online:
            Profile.objects.filter(is_online=True, last_seen__lt=now - timedelta(seconds=120)).update(
                is_online=False,
            )

    @database_sync_to_async
    def mark_read(self, message_id):
        from .models import Message
        message = (
            Message.objects
            .select_related('conversation')
            .filter(pk=message_id, conversation_id=self.conversation_id)
            .first()
        )
        if not message:
            return None
        message.mark_read_by(self.user)
        return message.id


# ---------- Helpers used by REST views to fan out events ----------

def notify_call_event(call, event, extra=None):
    """Fan a call event to the conversation room and each user's personal room.

    The conversation room serves the peer with the chat pane open; the user
    rooms make rings/ends arrive even when no chat socket is connected.
    """
    payload = dict(extra or {})
    _group_send_sync(f'chat-{call.conversation_id}', {'type': event, **payload})
    for user_id in (call.initiator_id, call.callee_id):
        _group_send_sync(
            USER_ROOM.format(user_id=user_id),
            {'type': event, **payload},
        )


def _group_send_sync(group, event):
    """Fire a channel-layer event from sync code (best-effort)."""
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    layer = get_channel_layer()
    if layer is None:
        return
    async_to_sync(layer.group_send)(group, event)


def notify_new_message(message):
    """Broadcast a new message to the conversation group and recipients."""
    from .serializers import MessageSerializer

    # Reaching the channel layer means the server has accepted delivery.
    message.mark_delivered()

    payload = MessageSerializer(message).data
    _group_send_sync(
        f'chat-{message.conversation_id}',
        {'type': 'message.new', 'message': payload},
    )
    # Notify all other participants in their personal rooms (unreads).
    for participant in message.conversation.participants.select_related('user'):
        if participant.user_id == message.sender_id:
            continue
        _group_send_sync(
            USER_ROOM.format(user_id=participant.user_id),
            {
                'type': 'conversation.new',
                'conversation_id': message.conversation_id,
                'message': payload,
                'sender': {'id': message.sender_id, 'display_name': message.sender.get_display_name()},
            },
        )
        _group_send_sync(
            USER_ROOM.format(user_id=participant.user_id),
            {
                'type': 'notification.event',
                'notification': {
                    'kind': 'message',
                    'conversation_id': message.conversation_id,
                    'message_id': message.id,
                },
            },
        )


def broadcast_message_edited(message):
    _group_send_sync(
        f'chat-{message.conversation_id}',
        {
            'type': 'message.edited',
            'message_id': message.id,
            'body': message.body,
            'edited_at': message.edited_at.isoformat() if message.edited_at else None,
        },
    )


def broadcast_message_deleted(message):
    _group_send_sync(
        f'chat-{message.conversation_id}',
        {'type': 'message.deleted', 'message_id': message.id},
    )


def broadcast_reaction(message, user, emoji, added):
    _group_send_sync(
        f'chat-{message.conversation_id}',
        {
            'type': 'reaction.updated',
            'message_id': message.id,
            'emoji': emoji,
            'user_id': user.id,
            'added': added,
        },
    )
