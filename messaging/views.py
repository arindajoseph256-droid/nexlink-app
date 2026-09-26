"""DRF API views for conversations, messages, search and receipts."""
from django.contrib.auth import get_user_model
from django.http import FileResponse
from django.db.models import Count, OuterRef, Q, Subquery
from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions, status
from rest_framework.decorators import api_view, permission_classes, throttle_classes, throttle_scope
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from accounts.models import Profile

from .models import (
    BlockedUser,
    Call,
    Contact,
    Conversation,
    ConversationParticipant,
    Message,
    MessageUserState,
    MessageVisibility,
    Notification,
    Reaction,
    UserReport,
)
from .serializers import (
    ConversationSerializer,
    MessageSerializer,
    ReactionSerializer,
    UserSearchSerializer,
    ContactSerializer,
    ChatPeopleSerializer,
)

User = get_user_model()


def _profile_map(user_ids):
    """Map user_id -> Profile for presence lookups in one query."""
    profiles = Profile.objects.filter(user_id__in=user_ids).select_related('user')
    return {profile.user_id: profile for profile in profiles}


class ConversationListView(generics.ListAPIView):
    """List the viewer's conversations, most recent activity first."""

    serializer_class = ConversationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        last_message_qs = Message.objects.filter(
            conversation=OuterRef('pk'),
        ).order_by('-created_at')

        return (
            Conversation.objects
            .filter(participants__user=user)
            .select_related()
            .prefetch_related(
                'participants__user__profile',
            )
            .annotate(
                last_message_id_annot=Subquery(last_message_qs.values('id')[:1]),
                last_message_body=Subquery(last_message_qs.values('body')[:1]),
                last_message_deleted=Subquery(last_message_qs.values('is_deleted')[:1]),
                last_message_sender=Subquery(last_message_qs.values('sender_id')[:1]),
                last_message_at=Subquery(last_message_qs.values('created_at')[:1]),
            )
            .annotate(participants_list_ids=Count('participants', distinct=True))
        )

    def list(self, request, *args, **kwargs):
        queryset = self.get_queryset()
        viewer_participants = {
            p.conversation_id: p for p in ConversationParticipant.objects.filter(user=request.user)
        }

        # Fetch actual last messages and attach for the serializer.
        message_ids = [c.last_message_id_annot for c in queryset if c.last_message_id_annot]
        messages = {
            m.id: m
            for m in Message.objects.filter(id__in=message_ids).select_related('sender')
        }

        data = []
        for conversation in queryset:
            conversation.participants_list = list(conversation.participants.all())
            conversation.last_message_cached = messages.get(conversation.last_message_id_annot)
            conversation.viewer_participant = viewer_participants.get(conversation.pk)
            data.append(conversation)
        serializer = self.get_serializer(data, many=True)
        return Response(serializer.data)


class ConversationCreateView(generics.CreateAPIView):
    """Start (or fetch) a 1:1 conversation with another user."""

    permission_classes = [permissions.IsAuthenticated]

    def create(self, request, *args, **kwargs):
        target_id = request.data.get('user_id')
        if not target_id:
            return Response({'detail': 'user_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        target = User.objects.filter(pk=target_id).exclude(pk=request.user.pk).first()
        if not target:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)
        if BlockedUser.objects.filter(
            Q(blocker=request.user, blocked=target)
            | Q(blocker=target, blocked=request.user),
        ).exists():
            return Response({'detail': 'This user is unavailable.'}, status=status.HTTP_403_FORBIDDEN)

        conversation, created = Conversation.get_or_create_between(request.user, target)
        if created:
            # Unhide on both sides for a fresh conversation.
            conversation.participants.update(is_hidden=False)

        participant = conversation.participant_for(request.user)
        participant.is_hidden = False
        participant.save(update_fields=['is_hidden'])

        # Serializer needs the attributes ConversationListView.list attaches.
        conversation.participants_list = list(
            conversation.participants.select_related('user__profile'),
        )
        conversation.last_message_cached = None

        conversation.viewer_participant = participant
        serializer = ConversationSerializer(conversation, context={'request': request})
        return Response(serializer.data, status=status.HTTP_201_CREATED if created else 200)


class MessageListCreateView(generics.ListCreateAPIView):
    """List messages in a conversation the viewer belongs to; create new ones.

    Cursor pagination: returns the most recent `page_size` messages by
    default; `?before=<message_id>` returns the page older than that id.
    The response envelope is {results, has_more, oldest_id}.
    """

    serializer_class = MessageSerializer
    permission_classes = [permissions.IsAuthenticated]
    page_size = 50
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'messages'

    def _get_conversation(self, request):
        conversation = get_object_or_404(
            Conversation.objects.select_related(),
            pk=self.kwargs['conversation_id'],
        )
        if not conversation.is_participant(request.user):
            self.permission_denied(
                request,
                message='You are not a participant of this conversation.',
            )
        return conversation

    def get_base_queryset(self, conversation):
        from django.db.models import Prefetch

        from .models import MessageUserState

        return (
            Message.objects
            .filter(conversation=conversation)
            .exclude(hidden_for__user=self.request.user)
            .select_related('sender__profile', 'reply_to__sender')
            .prefetch_related(
                'reactions__user',
                'read_statuses',
                Prefetch(
                    'user_states',
                    queryset=MessageUserState.objects.filter(user=self.request.user),
                    to_attr='viewer_states',
                ),
            )
        )

    def list(self, request, *args, **kwargs):
        conversation = self._get_conversation(request)
        queryset = self.get_base_queryset(conversation)

        before_id = request.query_params.get('before')
        if before_id:
            try:
                before_id = int(before_id)
            except (TypeError, ValueError):
                return Response({'detail': 'Invalid cursor.'}, status=status.HTTP_400_BAD_REQUEST)
            queryset = queryset.filter(pk__lt=before_id)

        # Newest page (descending), then flip back to chronological order.
        page = list(queryset.order_by('-pk')[: self.page_size])
        page.reverse()

        serializer = self.get_serializer(page, many=True)
        has_more = False
        oldest_id = None
        if page:
            oldest_id = page[0].pk
            has_more = queryset.filter(pk__lt=oldest_id).exists()
        return Response(
            {'results': serializer.data, 'has_more': has_more, 'oldest_id': oldest_id},
        )

    def perform_create(self, serializer):
        conversation = self._get_conversation(self.request)
        peer_ids = conversation.participants.exclude(user=self.request.user).values('user_id')
        if BlockedUser.objects.filter(
            Q(blocker=self.request.user, blocked__in=peer_ids)
            | Q(blocked=self.request.user, blocker__in=peer_ids),
        ).exists():
            self.permission_denied(self.request, message='Messaging is unavailable for this conversation.')
        reply_to = None
        reply_id = self.request.data.get('reply_to')
        if reply_id:
            reply_to = get_object_or_404(
                Message, pk=reply_id, conversation=conversation,
            )
        message = serializer.save(conversation=conversation, sender=self.request.user,
                                  reply_to=reply_to)
        recipients = conversation.participants.exclude(user=self.request.user).select_related('user')
        Notification.objects.bulk_create([
            Notification(
                recipient=participant.user,
                actor=self.request.user,
                kind=Notification.Kind.MESSAGE,
                text=f'{self.request.user.get_display_name()} sent you a message.',
                conversation=conversation,
                message=message,
            )
            for participant in recipients
        ], ignore_conflicts=True)
        self._deliver(message)

    def _deliver(self, message):
        """Mark as delivered for online recipients via the channel layer."""
        from .consumers import notify_new_message

        try:
            notify_new_message(message)
        except Exception:
            pass  # realtime is best-effort; REST response still succeeds


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def mark_conversation_read(request, conversation_id):
    """Mark every message in the conversation as read by the viewer."""
    conversation = get_object_or_404(Conversation, pk=conversation_id)
    participant = conversation.participant_for(request.user)
    if not participant:
        return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)

    unread_messages = conversation.messages.filter(
        is_deleted=False,
    ).exclude(sender=request.user).order_by('created_at')
    for message in unread_messages:
        message.mark_read_by(request.user)
    return Response({'status': 'ok', 'conversation': conversation.pk})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def react_to_message(request, message_id):
    """Toggle the viewer's emoji reaction on a message."""
    message = get_object_or_404(Message, pk=message_id)
    if not message.conversation.is_participant(request.user):
        return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)

    emoji = (request.data.get('emoji') or '').strip()
    if not emoji or len(emoji) > 8:
        return Response({'detail': 'A short emoji is required.'}, status=status.HTTP_400_BAD_REQUEST)

    reaction, created = Reaction.objects.get_or_create(
        message=message, user=request.user, emoji=emoji,
    )
    if not created:
        reaction.delete()
    elif message.sender_id != request.user.pk:
        Notification.objects.get_or_create(
            recipient=message.sender,
            actor=request.user,
            kind=Notification.Kind.REACTION,
            conversation=message.conversation,
            message=message,
            defaults={'text': f'{request.user.get_display_name()} reacted to your message.'},
        )

    from .consumers import broadcast_reaction
    try:
        broadcast_reaction(message, request.user, emoji, added=created)
    except Exception:
        pass

    return Response({'status': 'ok', 'added': created, 'emoji': emoji})


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
@throttle_classes([ScopedRateThrottle])
@throttle_scope('search')
def search_users(request):
    """Search by phone/email, or by name among known contacts/chat members.

    Phone lookups: the query is normalized to E.164 first, so '+1415…' and
    '415…' (default region) find the same account. Name lookups match the
    display name or first name. Results are capped and never include email
    or the full phone number.
    """
    from accounts.phones import normalize_e164
    from django.core.exceptions import ValidationError

    query = (request.query_params.get('q') or '').strip()
    if not query:
        return Response({'results': []})

    matched_users = User.objects.none()

    # Phone lookup: only when the query looks phone-ish (starts with + or
    # is mostly digits) so typing a name does not hit the phone index.
    digits_only = query.lstrip('+').replace(' ', '')
    if query.startswith('+') or (digits_only.isdigit() and len(digits_only) >= 7):
        try:
            phone = normalize_e164(query)
        except ValidationError:
            phone = None
        if phone:
            matched_users = User.objects.filter(phone_number=phone)

    # Email lookup is exact to avoid exposing a broad email directory.
    if not matched_users.exists() and '@' in query:
        matched_users = User.objects.filter(email__iexact=query)

    if not matched_users.exists():
        known_people = User.objects.filter(
            Q(contacted_by__owner=request.user)
            | Q(conversation_memberships__conversation__participants__user=request.user),
        ).exclude(pk=request.user.pk).distinct()
        profiles = (
            Profile.objects
            .select_related('user')
            .filter(user__in=known_people)
            .filter(
                Q(display_name__icontains=query)
                | Q(user__first_name__icontains=query)
                | Q(user__last_name__icontains=query)
            )
            .exclude(user=request.user)
            .order_by('user__first_name')[:20]
        )
        matched_users = User.objects.filter(
            pk__in=[p.user_id for p in profiles],
        ).select_related('profile')

    blocked_pairs = BlockedUser.objects.filter(
        Q(blocker=request.user) | Q(blocked=request.user),
    ).values_list('blocker_id', 'blocked_id')
    excluded_ids = {request.user.pk}
    for blocker_id, blocked_id in blocked_pairs:
        excluded_ids.update((blocker_id, blocked_id))
    matched_users = matched_users.exclude(pk__in=excluded_ids)[:20]
    serializer = UserSearchSerializer(matched_users, many=True)
    return Response({'results': serializer.data})


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def chat_people(request):
    """Return distinct people from the viewer's existing direct chats."""
    memberships = ConversationParticipant.objects.filter(
        user=request.user,
        conversation__kind=Conversation.Kind.DM,
    ).values('conversation_id')
    people = User.objects.filter(
        conversation_memberships__conversation_id__in=Subquery(memberships),
    ).exclude(pk=request.user.pk).select_related('profile').distinct().order_by(
        'first_name', 'phone_number',
    )[:100]
    results = []
    for person in people:
        profile = getattr(person, 'profile', None)
        avatar_url = None
        if profile and profile.picture and profile.photo_visibility != 'nobody':
            avatar_url = request.build_absolute_uri(
                f'/accounts/users/{person.pk}/avatar/',
            )
        results.append({
            'id': person.pk,
            'display_name': person.get_display_name(),
            'masked_phone': person.masked_phone,
            'avatar_url': avatar_url,
        })
    return Response({'results': results})


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
@throttle_classes([ScopedRateThrottle])
@throttle_scope('search')
def search_conversations(request):
    query = (request.query_params.get('q') or '').strip()
    if not query:
        return Response({'results': []})
    conversation_ids = ConversationParticipant.objects.filter(
        user=request.user, is_hidden=False,
    ).values('conversation_id')
    conversations = Conversation.objects.filter(
        pk__in=Subquery(conversation_ids),
    ).filter(
        Q(name__icontains=query)
        | Q(messages__body__icontains=query, messages__is_deleted=False),
    ).distinct().prefetch_related('participants__user__profile')[:50]
    results = []
    for conversation in conversations:
        participants = list(conversation.participants.all())
        peer_name = next(
            (p.user.get_display_name() for p in participants if p.user_id != request.user.pk),
            'Conversation',
        )
        results.append({
            'conversation_id': conversation.id,
            'name': conversation.name or peer_name,
            'kind': conversation.kind,
            'updated_at': conversation.updated_at,
        })
    return Response({'results': results})


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
@throttle_classes([ScopedRateThrottle])
@throttle_scope('search')
def search_messages(request):
    query = (request.query_params.get('q') or '').strip()
    if not query:
        return Response({'results': []})
    messages = Message.objects.filter(
        conversation__participants__user=request.user,
        body__icontains=query,
        is_deleted=False,
    ).exclude(hidden_for__user=request.user).select_related('conversation', 'sender')[:50]
    return Response({'results': [
        {
            'id': message.id,
            'conversation_id': message.conversation_id,
            'body': message.body,
            'sender_id': message.sender_id,
            'created_at': message.created_at,
        }
        for message in messages
    ]})


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
@throttle_classes([ScopedRateThrottle])
@throttle_scope('search')
def chat_people(request):
    """Everyone the viewer has ever chatted with (WhatsApp-style contacts).

    Returns one entry per user who shares a conversation with the viewer,
    with the masked phone number as the secondary line. Ordered by most
    recent conversation activity so the picker feels like WhatsApp's.
    """
    conversation_ids = ConversationParticipant.objects.filter(
        user=request.user,
    ).values('conversation_id')

    peer_ids = set(
        ConversationParticipant.objects.filter(
            conversation_id__in=Subquery(conversation_ids),
        )
        .exclude(user=request.user)
        .values_list('user_id', flat=True),
    )
    if not peer_ids:
        return Response({'results': []})

    peers = (
        User.objects
        .filter(pk__in=peer_ids)
        .select_related('profile')
    )
    serializer = ChatPeopleSerializer(peers, many=True)
    return Response({'results': serializer.data})


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def notification_list(request):
    """List the viewer's most recent notifications."""
    notifications = (
        Notification.objects
        .filter(recipient=request.user)
        .select_related('actor__profile', 'conversation')[:30]
    )
    payload = [
        {
            'id': n.id,
            'kind': n.kind,
            'text': n.text,
            'is_read': n.is_read,
            'conversation_id': n.conversation_id,
            'actor': n.actor.username if n.actor else None,
            'created_at': n.created_at,
        }
        for n in notifications
    ]
    unread = Notification.objects.filter(recipient=request.user, is_read=False).count()
    return Response({'results': payload, 'unread': unread})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def notifications_mark_read(request):
    """Mark all (or one) notification as read."""
    notification_id = request.data.get('id')
    qs = Notification.objects.filter(recipient=request.user, is_read=False)
    if notification_id:
        qs = qs.filter(pk=notification_id)
    updated = qs.update(is_read=True)
    return Response({'status': 'ok', 'updated': updated})


@api_view(['GET', 'POST'])
@permission_classes([permissions.IsAuthenticated])
def contacts(request):
    """List or add contacts owned by the authenticated user."""
    if request.method == 'GET':
        queryset = Contact.objects.filter(
            owner=request.user,
        ).select_related('contact__profile')
        return Response({'results': ContactSerializer(queryset, many=True).data})

    target = User.objects.filter(
        pk=request.data.get('user_id'),
    ).exclude(pk=request.user.pk).first()
    if not target:
        return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)
    contact, created = Contact.objects.get_or_create(
        owner=request.user,
        contact=target,
        defaults={'nickname': (request.data.get('nickname') or '').strip()[:80]},
    )
    if not created and 'nickname' in request.data:
        contact.nickname = (request.data.get('nickname') or '').strip()[:80]
        contact.save(update_fields=['nickname'])
    return Response(
        ContactSerializer(contact).data,
        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
    )


@api_view(['DELETE'])
@permission_classes([permissions.IsAuthenticated])
def remove_contact(request, user_id):
    deleted, _ = Contact.objects.filter(
        owner=request.user, contact_id=user_id,
    ).delete()
    if not deleted:
        return Response({'detail': 'Contact not found.'}, status=status.HTTP_404_NOT_FOUND)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST', 'DELETE'])
@permission_classes([permissions.IsAuthenticated])
def block_user(request, user_id):
    target = User.objects.filter(pk=user_id).exclude(pk=request.user.pk).first()
    if not target:
        return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)
    if request.method == 'POST':
        BlockedUser.objects.get_or_create(blocker=request.user, blocked=target)
        return Response({'status': 'blocked'})
    BlockedUser.objects.filter(blocker=request.user, blocked=target).delete()
    return Response({'status': 'unblocked'})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def report_user(request, user_id):
    target = User.objects.filter(pk=user_id).exclude(pk=request.user.pk).first()
    if not target:
        return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)
    reason = (request.data.get('reason') or '').strip()
    valid_reasons = {choice for choice, _ in UserReport.Reason.choices}
    if reason not in valid_reasons:
        return Response({'detail': 'Pick a report reason.'}, status=status.HTTP_400_BAD_REQUEST)
    UserReport.objects.create(
        reporter=request.user,
        reported=target,
        reason=reason,
        details=(request.data.get('details') or '').strip()[:500],
    )
    BlockedUser.objects.get_or_create(blocker=request.user, blocked=target)
    return Response({'status': 'reported'}, status=status.HTTP_201_CREATED)


@api_view(['PATCH'])
@permission_classes([permissions.IsAuthenticated])
def edit_message(request, message_id):
    """Edit a message the viewer authored (soft-tracked with edited_at)."""
    message = get_object_or_404(
        Message.objects.select_related('conversation'),
        pk=message_id,
    )
    if message.sender_id != request.user.pk:
        return Response({'detail': 'You can only edit your own messages.'},
                        status=status.HTTP_403_FORBIDDEN)
    if message.is_deleted:
        return Response({'detail': 'This message was deleted.'}, status=status.HTTP_400_BAD_REQUEST)

    body = (request.data.get('body') or '').strip()
    if not body:
        return Response({'detail': 'Message body cannot be empty.'},
                        status=status.HTTP_400_BAD_REQUEST)
    if len(body) > 4000:
        return Response({'detail': 'Message too long (max 4000 characters).'},
                        status=status.HTTP_400_BAD_REQUEST)

    from django.utils import timezone
    message.body = body
    message.edited_at = timezone.now()
    message.save(update_fields=['body', 'edited_at'])

    from .consumers import broadcast_message_edited
    try:
        broadcast_message_edited(message)
    except Exception:
        pass

    return Response(MessageSerializer(message, context={'request': request}).data)


@api_view(['DELETE'])
@permission_classes([permissions.IsAuthenticated])
def delete_message(request, message_id):
    """Soft-delete a message the viewer authored."""
    message = get_object_or_404(
        Message.objects.select_related('conversation'),
        pk=message_id,
    )
    if message.sender_id != request.user.pk:
        return Response({'detail': 'You can only delete your own messages.'},
                        status=status.HTTP_403_FORBIDDEN)

    conversation = message.conversation
    message.soft_delete()

    from .consumers import broadcast_message_deleted
    try:
        broadcast_message_deleted(message)
    except Exception:
        pass

    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['DELETE'])
@permission_classes([permissions.IsAuthenticated])
def delete_message_for_me(request, message_id):
    message = get_object_or_404(
        Message.objects.select_related('conversation'), pk=message_id,
    )
    if not message.conversation.is_participant(request.user):
        return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)
    MessageVisibility.objects.get_or_create(message=message, user=request.user)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def download_attachment(request, message_id):
    """Stream an attachment only to a current conversation participant."""
    message = get_object_or_404(
        Message.objects.select_related('conversation'), pk=message_id,
    )
    if not message.attachment or not message.conversation.is_participant(request.user):
        return Response({'detail': 'Attachment not found.'}, status=status.HTTP_404_NOT_FOUND)
    if not message.visible_to(request.user):
        return Response({'detail': 'Attachment not found.'}, status=status.HTTP_404_NOT_FOUND)
    response = FileResponse(
        message.attachment.open('rb'),
        as_attachment=True,
        filename=message.attachment_name or 'download',
    )
    if message.attachment_mime_type:
        response['Content-Type'] = message.attachment_mime_type
    return response


def _group_payload(conversation):
    participants = conversation.participants.select_related('user__profile').order_by('id')
    return {
        'id': conversation.id,
        'name': conversation.name,
        'description': conversation.description,
        'created_by': conversation.created_by_id,
        'participants': [
            {
                'id': member.user_id,
                'display_name': member.user.get_display_name(),
                'avatar_url': member.user.profile.avatar_url if hasattr(member.user, 'profile') else None,
                'is_admin': member.is_admin,
            }
            for member in participants
        ],
    }


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def create_group(request):
    from django.core.exceptions import ValidationError

    name = (request.data.get('name') or '').strip()
    user_ids = request.data.get('user_ids') or []
    phone_numbers = request.data.get('phone_numbers') or []
    if phone_numbers:
        from accounts.phones import normalize_e164
        normalized = []
        for raw_phone in phone_numbers:
            try:
                normalized.append(normalize_e164(raw_phone))
            except ValidationError:
                return Response({'detail': 'Enter valid phone numbers.'}, status=400)
        user_ids = list(User.objects.filter(phone_number__in=normalized).values_list('id', flat=True))
    if not name or len(name) > 100:
        return Response({'detail': 'A group name up to 100 characters is required.'}, status=400)
    if not isinstance(user_ids, list) or not user_ids:
        return Response({'detail': 'Add at least one other user.'}, status=400)
    targets = list(User.objects.filter(pk__in=user_ids).exclude(pk=request.user.pk))
    if len(targets) != len(set(user_ids)):
        return Response({'detail': 'One or more users could not be found.'}, status=404)
    if BlockedUser.objects.filter(
        Q(blocker=request.user, blocked__in=targets)
        | Q(blocked=request.user, blocker__in=targets),
    ).exists():
        return Response({'detail': 'A selected user is unavailable.'}, status=403)
    conversation = Conversation.objects.create(
        kind=Conversation.Kind.GROUP,
        name=name,
        description=(request.data.get('description') or '').strip()[:500],
        created_by=request.user,
    )
    ConversationParticipant.objects.bulk_create([
        ConversationParticipant(conversation=conversation, user=request.user, is_admin=True),
        *[ConversationParticipant(conversation=conversation, user=target) for target in targets],
    ])
    return Response(_group_payload(conversation), status=status.HTTP_201_CREATED)


@api_view(['GET', 'PATCH'])
@permission_classes([permissions.IsAuthenticated])
def group_detail(request, conversation_id):
    conversation = get_object_or_404(Conversation, pk=conversation_id, kind=Conversation.Kind.GROUP)
    if not conversation.is_participant(request.user):
        return Response({'detail': 'Forbidden.'}, status=403)
    if request.method == 'PATCH':
        actor = conversation.participant_for(request.user)
        if not actor.is_admin:
            return Response({'detail': 'Only group admins can edit the group.'}, status=403)
        name = (request.data.get('name', conversation.name) or '').strip()
        if not name or len(name) > 100:
            return Response({'detail': 'A valid group name is required.'}, status=400)
        conversation.name = name
        conversation.description = (
            request.data.get('description', conversation.description) or ''
        ).strip()[:500]
        conversation.save(update_fields=['name', 'description', 'updated_at'])
    return Response(_group_payload(conversation))


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def leave_group(request, conversation_id):
    conversation = get_object_or_404(
        Conversation, pk=conversation_id, kind=Conversation.Kind.GROUP,
    )
    member = conversation.participant_for(request.user)
    if not member:
        return Response({'detail': 'You are not a member.'}, status=403)
    if member.is_admin and not conversation.participants.filter(
        is_admin=True,
    ).exclude(pk=member.pk).exists():
        return Response({'detail': 'Promote another admin before leaving.'}, status=400)
    member.delete()
    return Response({'status': 'left'})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def add_group_member(request, conversation_id):
    conversation = get_object_or_404(Conversation, pk=conversation_id, kind=Conversation.Kind.GROUP)
    actor = conversation.participant_for(request.user)
    if not actor or not actor.is_admin:
        return Response({'detail': 'Only group admins can add members.'}, status=403)
    target = User.objects.filter(pk=request.data.get('user_id')).exclude(pk=request.user.pk).first()
    if not target:
        return Response({'detail': 'User not found.'}, status=404)
    member, created = ConversationParticipant.objects.get_or_create(
        conversation=conversation, user=target,
    )
    member.is_hidden = False
    member.save(update_fields=['is_hidden'])
    return Response(_group_payload(conversation), status=201 if created else 200)


@api_view(['DELETE'])
@permission_classes([permissions.IsAuthenticated])
def remove_group_member(request, conversation_id, user_id):
    conversation = get_object_or_404(Conversation, pk=conversation_id, kind=Conversation.Kind.GROUP)
    actor = conversation.participant_for(request.user)
    target = conversation.participants.filter(user_id=user_id).first()
    if not actor or not target:
        return Response({'detail': 'Member not found.'}, status=404)
    if target.user_id != request.user.pk and not actor.is_admin:
        return Response({'detail': 'Only group admins can remove members.'}, status=403)
    if target.is_admin and target.user_id != request.user.pk and not conversation.participants.filter(is_admin=True).exclude(pk=target.pk).exists():
        return Response({'detail': 'Promote another admin before removing the last admin.'}, status=400)
    target.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def promote_group_admin(request, conversation_id, user_id):
    conversation = get_object_or_404(Conversation, pk=conversation_id, kind=Conversation.Kind.GROUP)
    actor = conversation.participant_for(request.user)
    target = conversation.participants.filter(user_id=user_id).first()
    if not actor or not actor.is_admin:
        return Response({'detail': 'Only group admins can promote members.'}, status=403)
    if not target:
        return Response({'detail': 'Member not found.'}, status=404)
    target.is_admin = True
    target.save(update_fields=['is_admin'])
    return Response(_group_payload(conversation))


# ---------- Per-user conversation & message state (Nexus dashboard) ----------


def _participant_or_403(conversation_id, request):
    conversation = get_object_or_404(Conversation, pk=conversation_id)
    participant = conversation.participant_for(request.user)
    if not participant:
        return None, None, Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)
    return conversation, participant, None


@api_view(['PATCH'])
@permission_classes([permissions.IsAuthenticated])
def conversation_state(request, conversation_id):
    """Toggle the viewer's pinned/muted/archived/hidden flags on a chat."""
    conversation, participant, error = _participant_or_403(conversation_id, request)
    if error:
        return error
    allowed = {'is_pinned': 'pinned', 'is_muted': 'muted',
               'is_archived': 'archived', 'is_hidden': 'hidden'}
    changes = {}
    for field, name in allowed.items():
        if name in request.data:
            value = bool(request.data[name])
            setattr(participant, field, value)
            changes[field] = value
    if not changes:
        return Response({'detail': 'Nothing to update.'}, status=status.HTTP_400_BAD_REQUEST)
    participant.save(update_fields=list(changes.keys()))
    return Response({'status': 'ok', 'conversation': conversation.pk,
                     **{allowed[field]: value for field, value in changes.items()}})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def clear_chat(request, conversation_id):
    """Hide every message for the viewer only (their view is empty)."""
    conversation, participant, error = _participant_or_403(conversation_id, request)
    if error:
        return error
    MessageVisibility.objects.bulk_create([
        MessageVisibility(message=message, user=request.user)
        for message in conversation.messages.exclude(hidden_for__user=request.user)
    ], ignore_conflicts=True)
    return Response({'status': 'ok', 'conversation': conversation.pk})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def message_star(request, message_id):
    """Toggle the viewer's star on a message."""
    message = get_object_or_404(Message, pk=message_id)
    if not message.conversation.is_participant(request.user):
        return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)
    state, _ = MessageUserState.objects.get_or_create(message=message, user=request.user)
    state.is_starred = not state.is_starred
    state.save(update_fields=['is_starred', 'updated_at'])
    return Response({'status': 'ok', 'starred': state.is_starred})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def message_pin(request, message_id):
    """Toggle the viewer's pin on a message (pinned banner shows the latest)."""
    message = get_object_or_404(Message, pk=message_id)
    if not message.conversation.is_participant(request.user):
        return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)
    state, _ = MessageUserState.objects.get_or_create(message=message, user=request.user)
    state.is_pinned = not state.is_pinned
    state.save(update_fields=['is_pinned', 'updated_at'])
    return Response({'status': 'ok', 'pinned': state.is_pinned})


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def starred_messages(request):
    """Messages the viewer starred across all conversations."""
    states = MessageUserState.objects.filter(
        user=request.user, is_starred=True,
        message__conversation__participants__user=request.user,
    ).select_related('message__sender__profile', 'message__conversation').order_by('-updated_at')
    serializer = MessageSerializer(
        [s.message for s in states], many=True, context={'request': request},
    )
    return Response({'results': serializer.data})


# ---------- Calls (1:1, WebRTC media; signaling via the chat socket) ----------


def _call_payload(call, viewer):
    peer = call.callee if call.initiator_id == viewer.pk else call.initiator
    profile = getattr(peer, 'profile', None)
    return {
        'id': call.id,
        'conversation': call.conversation_id,
        'kind': call.kind,
        'status': call.status,
        'direction': 'outgoing' if call.initiator_id == viewer.pk else 'incoming',
        'peer': {
            'id': peer.id,
            'display_name': peer.get_display_name(),
            'avatar_url': profile.avatar_url if profile else None,
        },
        'duration_seconds': call.duration_seconds,
        'created_at': call.started_at,
    }


def _signal(call, event, extra=None):
    """Relay a call event over the channel layer.

    Ring/lifecycle events fan out to both user rooms too, so they arrive
    even when the peer has no chat socket open. Signaling (SDP/ICE) stays
    on the conversation room: both peers connect it before exchanging media.
    """
    from .consumers import _group_send_sync, notify_call_event

    payload = {
        'call_id': call.id,
        'conversation_id': call.conversation_id,
        'kind': call.kind,
        'from_id': None,
    }
    payload.update(extra or {})
    if event == 'call.signal':
        _group_send_sync(f'chat-{call.conversation_id}', {'type': event, **payload})
    else:
        notify_call_event(call, event, payload)


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def call_start(request, conversation_id):
    conversation = get_object_or_404(Conversation, pk=conversation_id)
    participant = conversation.participant_for(request.user)
    if not participant:
        return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)
    if conversation.kind != Conversation.Kind.DM:
        return Response({'detail': 'Calls are 1:1 only.'}, status=400)
    peer_member = conversation.participants.exclude(user=request.user).first()
    if not peer_member:
        return Response({'detail': 'Calls are 1:1 only.'}, status=400)
    if BlockedUser.objects.filter(
        Q(blocker=request.user, blocked=peer_member.user)
        | Q(blocked=request.user, blocker=peer_member.user),
    ).exists():
        return Response({'detail': 'Unavailable.'}, status=403)
    kind = request.data.get('kind') or 'voice'
    if kind not in (Call.Type.VOICE, Call.Type.VIDEO):
        return Response({'detail': 'kind must be voice or video.'}, status=400)
    active = Call.objects.filter(
        conversation=conversation, callee=peer_member.user, status=Call.Status.RINGING,
    ).first()
    if active:
        return Response({'detail': 'Already ringing.'}, status=409)
    call = Call.objects.create(
        conversation=conversation,
        initiator=request.user,
        callee=peer_member.user,
        kind=kind,
    )
    _signal(call, 'call.incoming', {
        'caller': request.user.get_display_name(),
        'caller_id': request.user.pk,
    })
    return Response(_call_payload(call, request.user), status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def call_answer(request, call_id):
    call = get_object_or_404(Call, pk=call_id)
    if call.callee_id != request.user.pk or call.status != Call.Status.RINGING:
        return Response({'detail': 'Not answerable.'}, status=400)
    from django.utils import timezone

    call.status = Call.Status.ACTIVE
    call.answered_at = timezone.now()
    call.save(update_fields=['status', 'answered_at'])
    _signal(call, 'call.accepted', {'answered_by': request.user.pk})
    return Response(_call_payload(call, request.user))


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def call_decline(request, call_id):
    call = get_object_or_404(Call, pk=call_id)
    if call.callee_id != request.user.pk:
        return Response({'detail': 'Forbidden.'}, status=403)
    if call.status == Call.Status.RINGING:
        call.finish(Call.Status.DECLINED)
        _signal(call, 'call.ended', {'reason': 'declined'})
    return Response(_call_payload(call, request.user))


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def call_end(request, call_id):
    call = get_object_or_404(Call, pk=call_id)
    if request.user.pk not in (call.initiator_id, call.callee_id):
        return Response({'detail': 'Forbidden.'}, status=403)
    if call.status in (Call.Status.RINGING, Call.Status.ACTIVE):
        if call.status == Call.Status.RINGING:
            call.finish(Call.Status.MISSED)
        else:
            call.finish(Call.Status.ENDED)
        _signal(call, 'call.ended', {'reason': call.status})
    return Response(_call_payload(call, request.user))


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def call_signal(request, call_id):
    """Relay WebRTC SDP/ICE payloads between the two callers."""
    call = get_object_or_404(Call, pk=call_id)
    if request.user.pk not in (call.initiator_id, call.callee_id):
        return Response({'detail': 'Forbidden.'}, status=403)
    signal_type = request.data.get('signal_type')
    if signal_type not in ('offer', 'answer', 'ice'):
        return Response({'detail': 'Invalid signal_type.'}, status=400)
    peer_id = call.callee_id if request.user.pk == call.initiator_id else call.initiator_id
    _signal(call, 'call.signal', {
        'signal_type': signal_type,
        'payload': request.data.get('payload'),
        'to_id': peer_id,
        'from_id': request.user.pk,
    })
    return Response({'status': 'ok'})


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def call_history(request):
    """All calls the viewer participated in, newest first."""
    calls = Call.objects.filter(
        Q(initiator=request.user) | Q(callee=request.user),
    ).select_related('initiator__profile', 'callee__profile')[:100]
    return Response({'results': [_call_payload(call, request.user) for call in calls]})


# ---------- Media gallery (Phase 6.2) ----------


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def conversation_media(request, conversation_id):
    """Images, files and links shared in one conversation (info panel)."""
    conversation = get_object_or_404(Conversation, pk=conversation_id)
    if not conversation.is_participant(request.user):
        return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)
    messages = (
        conversation.messages
        .filter(is_deleted=False)
        .exclude(hidden_for__user=request.user)
        .select_related('sender__profile')
        .order_by('-created_at')
    )
    media_rows = messages.exclude(attachment='')[:200]
    serializer = MessageSerializer(media_rows, many=True, context={'request': request})

    links = []
    import re

    pattern = re.compile(r'https?://[^\s<>"]+')
    for message in messages.filter(body__icontains='http')[:300]:
        for match in pattern.findall(message.body):
            links.append({
                'message_id': message.id,
                'url': match.rstrip('.,;:!?)'),
                'sender': message.sender.get_display_name(),
                'created_at': message.created_at,
            })
    return Response({'media': serializer.data, 'links': links[:100]})
