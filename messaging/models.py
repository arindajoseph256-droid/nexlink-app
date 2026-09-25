"""Messaging models: conversations, participants, messages, receipts, reactions."""
from django.conf import settings
from django.db import models
from django.utils import timezone

User = settings.AUTH_USER_MODEL


class Conversation(models.Model):
    """A conversation: a 1:1 direct message or a group chat."""

    class Kind(models.TextChoices):
        DM = 'dm', 'Direct message'
        GROUP = 'group', 'Group chat'

    kind = models.CharField(
        max_length=5,
        choices=Kind.choices,
        default=Kind.DM,
        db_index=True,
    )
    direct_key = models.CharField(
        max_length=50,
        unique=True,
        null=True,
        blank=True,
        editable=False,
        help_text='Stable sorted participant key for direct conversations.',
    )
    name = models.CharField(max_length=100, blank=True)          # groups
    description = models.CharField(max_length=500, blank=True)   # groups
    image = models.ImageField(                                   # groups
        upload_to='group_images/%Y/%m/', blank=True, null=True,
    )
    created_by = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='conversations_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        indexes = [
            models.Index(fields=['-updated_at']),
        ]

    def __str__(self):
        return f'Conversation #{self.pk}'

    def other_participants(self, user):
        """Participants other than the given user."""
        return (
            self.participants.exclude(user=user).select_related('user__profile').order_by('id')
        )

    def participant_for(self, user):
        """Return the ConversationParticipant row for a user, or None."""
        return self.participants.filter(user=user).first()

    def is_participant(self, user):
        return self.participants.filter(user=user).exists()

    @classmethod
    def between(cls, user_a, user_b):
        """Return the existing 1:1 conversation between two users, or None."""
        direct_key = cls.make_direct_key(user_a.pk, user_b.pk)
        keyed = cls.objects.filter(kind=cls.Kind.DM, direct_key=direct_key).first()
        if keyed:
            return keyed
        candidates = (
            cls.objects
            .filter(kind=cls.Kind.DM)
            .filter(participants__user=user_a)
            .filter(participants__user=user_b)
            .distinct()
        )
        for conversation in candidates:
            member_ids = set(
                conversation.participants.values_list('user_id', flat=True),
            )
            if member_ids == {user_a.pk, user_b.pk}:
                return conversation
        return None

    @staticmethod
    def make_direct_key(user_a_id, user_b_id):
        """Return the same key regardless of participant order."""
        first, second = sorted((int(user_a_id), int(user_b_id)))
        return f'{first}:{second}'

    @classmethod
    def get_or_create_between(cls, user_a, user_b):
        """Return (conversation, created) for a 1:1 conversation."""
        from django.db import IntegrityError, transaction

        if user_a.pk == user_b.pk:
            raise ValueError('A direct conversation needs two different users.')
        direct_key = cls.make_direct_key(user_a.pk, user_b.pk)
        with transaction.atomic():
            existing = cls.objects.filter(
                kind=cls.Kind.DM, direct_key=direct_key,
            ).first()
            if existing:
                return existing, False
            try:
                with transaction.atomic():
                    conversation = cls.objects.create(
                        kind=cls.Kind.DM,
                        direct_key=direct_key,
                        created_by=user_a,
                    )
            except IntegrityError:
                return cls.objects.get(direct_key=direct_key), False
            ConversationParticipant.objects.bulk_create([
                ConversationParticipant(conversation=conversation, user=user_a),
                ConversationParticipant(conversation=conversation, user=user_b),
            ])
        return conversation, True


class ConversationParticipant(models.Model):
    """Membership of a user in a conversation, with per-user state."""

    conversation = models.ForeignKey(
        Conversation,
        on_delete=models.CASCADE,
        related_name='participants',
    )
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='conversation_memberships',
    )
    joined_at = models.DateTimeField(auto_now_add=True)
    is_admin = models.BooleanField(
        default=False,
        help_text='Group admins can manage members and group info (DMs ignore this).',
    )
    is_hidden = models.BooleanField(
        default=False,
        help_text='User hid the conversation from their list (or left a DM).',
    )
    last_read_message = models.ForeignKey(
        'Message',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='read_marks',
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['conversation', 'user'],
                name='unique_participant_per_conversation',
            ),
        ]
        indexes = [
            models.Index(fields=['user', 'is_hidden']),
            models.Index(fields=['conversation', 'user']),
        ]

    def __str__(self):
        return f'{self.user} in conversation #{self.conversation_id}'


class Message(models.Model):
    """A single message inside a conversation."""

    class State(models.TextChoices):
        SENT = 'sent', 'Sent'
        DELIVERED = 'delivered', 'Delivered'
        READ = 'read', 'Read'

    class Type(models.TextChoices):
        TEXT = 'text', 'Text'
        IMAGE = 'image', 'Image'
        VIDEO = 'video', 'Video'
        AUDIO = 'audio', 'Audio'
        FILE = 'file', 'File'
        SYSTEM = 'system', 'System'

    conversation = models.ForeignKey(
        Conversation,
        on_delete=models.CASCADE,
        related_name='messages',
    )
    sender = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='sent_messages',
    )
    message_type = models.CharField(
        max_length=10,
        choices=Type.choices,
        default=Type.TEXT,
        db_index=True,
        help_text='Discriminator so new message kinds can be added later.',
    )
    body = models.TextField(max_length=4000, blank=True)
    attachment = models.FileField(
        upload_to='message_attachments/%Y/%m/', blank=True, null=True,
    )
    attachment_name = models.CharField(max_length=255, blank=True)
    attachment_size = models.PositiveBigIntegerField(null=True, blank=True)
    attachment_mime_type = models.CharField(max_length=100, blank=True)
    reply_to = models.ForeignKey(
        'self',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='replies',
    )
    state = models.CharField(
        max_length=10,
        choices=State.choices,
        default=State.SENT,
        db_index=True,
    )
    sent_at = models.DateTimeField(auto_now_add=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['conversation', 'created_at']),
            models.Index(fields=['sender', 'created_at']),
        ]

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if self.is_deleted:
            return
        # Bump conversation so ordering by recent activity works.
        Conversation.objects.filter(pk=self.conversation_id).update(updated_at=timezone.now())

    def __str__(self):
        preview = self.body[:30] + ('…' if len(self.body) > 30 else '')
        return f'Message from {self.sender} in #{self.conversation_id}: {preview}'

    def soft_delete(self):
        """Mark the message deleted while keeping thread structure."""
        self.is_deleted = True
        self.deleted_at = timezone.now()
        self.body = ''
        self.save(update_fields=['is_deleted', 'deleted_at', 'body'])

    def visible_to(self, user):
        """False when the viewer used 'delete for me' on this message."""
        return not self.hidden_for.filter(user=user).exists()

    def mark_delivered(self):
        """Record first delivery to any recipient (idempotent)."""
        if self.state == self.State.SENT:
            self.state = self.State.DELIVERED
            self.delivered_at = timezone.now()
            self.save(update_fields=['state', 'delivered_at'])

    def mark_read_by(self, user):
        """Record a read receipt for a participant (idempotent)."""
        participant = self.conversation.participant_for(user)
        if not participant or self.sender_id == user.pk:
            return False
        MessageReadStatus.objects.get_or_create(message=self, user=user)
        if self.state != self.State.READ:
            self.state = self.State.READ
            self.read_at = timezone.now()
            self.save(update_fields=['state', 'read_at'])
        newer = Message.objects.filter(
            conversation_id=self.conversation_id,
            created_at__gte=self.created_at,
        )
        participant.last_read_message = newer.order_by('-created_at').first() or self
        participant.save(update_fields=['last_read_message'])
        return True


class MessageReadStatus(models.Model):
    """Read receipt: which user read which message."""

    message = models.ForeignKey(
        Message,
        on_delete=models.CASCADE,
        related_name='read_statuses',
    )
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='message_reads',
    )
    read_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['message', 'user'],
                name='unique_read_per_user_per_message',
            ),
        ]
        indexes = [
            models.Index(fields=['user', 'message']),
        ]

    def __str__(self):
        return f'{self.user} read message #{self.message_id}'


class MessageVisibility(models.Model):
    """Per-user local deletion marker; the message remains for other members."""

    message = models.ForeignKey(
        Message, on_delete=models.CASCADE, related_name='hidden_for',
    )
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='hidden_messages',
    )
    hidden_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['message', 'user'], name='unique_message_visibility_per_user',
            ),
        ]
        indexes = [models.Index(fields=['user', 'message'])]


class Reaction(models.Model):
    """An emoji reaction attached to a message."""

    message = models.ForeignKey(
        Message,
        on_delete=models.CASCADE,
        related_name='reactions',
    )
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='reactions',
    )
    emoji = models.CharField(max_length=8)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['message', 'user', 'emoji'],
                name='unique_reaction_per_user_message_emoji',
            ),
        ]
        indexes = [
            models.Index(fields=['message']),
        ]

    def __str__(self):
        return f'{self.user} reacted {self.emoji} to #{self.message_id}'


class Notification(models.Model):
    """User-facing notification (new message, reactions, etc.)."""

    class Kind(models.TextChoices):
        MESSAGE = 'message', 'New message'
        REACTION = 'reaction', 'Reaction'
        SYSTEM = 'system', 'System'

    recipient = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='notifications',
    )
    actor = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='actions_as_actor',
    )
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.MESSAGE)
    text = models.CharField(max_length=255)
    conversation = models.ForeignKey(
        Conversation,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='notifications',
    )
    message = models.ForeignKey(
        Message,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='notifications',
    )
    is_read = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['recipient', 'is_read']),
            models.Index(fields=['recipient', '-created_at']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['recipient', 'message', 'kind'],
                condition=models.Q(message__isnull=False),
                name='unique_message_notification_per_recipient',
            ),
        ]

    def __str__(self):
        return f'Notification for {self.recipient}: {self.text[:40]}'


class Contact(models.Model):
    """A user's private contact list entry."""

    owner = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='contacts',
    )
    contact = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='contacted_by',
    )
    nickname = models.CharField(max_length=80, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['nickname', 'contact__first_name']
        constraints = [
            models.UniqueConstraint(
                fields=['owner', 'contact'], name='unique_contact_per_owner',
            ),
            models.CheckConstraint(
                condition=~models.Q(owner=models.F('contact')),
                name='contact_cannot_be_self',
            ),
        ]
        indexes = [models.Index(fields=['owner', 'created_at'])]


class BlockedUser(models.Model):
    """A directional block relationship."""

    blocker = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='blocked_users',
    )
    blocked = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='blocked_by',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['blocker', 'blocked'], name='unique_block_per_user',
            ),
            models.CheckConstraint(
                condition=~models.Q(blocker=models.F('blocked')),
                name='block_cannot_be_self',
            ),
        ]


class UserReport(models.Model):
    """Private abuse report, retained for moderation workflows."""

    reporter = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='submitted_reports',
    )
    reported = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='received_reports',
    )
    reason = models.CharField(max_length=500)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=['reported', '-created_at'])]
