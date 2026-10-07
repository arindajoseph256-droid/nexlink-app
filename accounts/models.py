"""Custom User model: phone-number identity plus Profile with avatar/status.

The phone number (stored E.164, unique) is the primary identity used for
registration, login and search. ``username`` remains as a technical field
(auto-derived from the phone number) so Django's auth stack, admin and
existing tooling keep working unchanged. Email is optional.
"""
from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from .managers import UserManager
from .phones import derive_username_from_phone, mask_e164


class User(AbstractUser):
    """User whose identity is a unique E.164 phone number.

    ``username`` is auto-derived (``u<digits>``) and kept unique for Django's
    auth machinery; humans never type it. ``phone_number`` is the canonical
    identity. Email is optional but unique when present.
    """

    phone_number = models.CharField(
        _('phone number'),
        max_length=16,
        unique=True,
        blank=True,
        null=True,
        help_text=_('E.164 formatted phone number, e.g. +14155551234.'),
        error_messages={
            'unique': _('An account with this phone number already exists.'),
        },
    )
    email = models.EmailField(_('email address'), unique=True, blank=True, null=True)

    objects = UserManager()

    USERNAME_FIELD = 'phone_number'
    REQUIRED_FIELDS = []

    class Meta:
        indexes = [
            models.Index(fields=['phone_number']),
            models.Index(fields=['username']),
            models.Index(fields=['email']),
        ]

    def clean(self):
        super().clean()
        if self.email:
            self.email = self.__class__.objects.normalize_email(self.email)

    def get_display_name(self):
        profile = getattr(self, 'profile', None)
        if profile and profile.display_name:
            return profile.display_name
        if self.first_name:
            return self.first_name
        return self.masked_phone

    @property
    def masked_phone(self):
        """+2567****5678 — for UI spots where the number should be hidden."""
        return mask_e164(self.phone_number or '')

    def __str__(self):
        return self.phone_number or self.username


def profile_picture_upload_to(instance, filename):
    """Store avatars per user: media/profile_pictures/user_<id>/<file>."""
    return f'profile_pictures/user_{instance.user_id}/{filename}'


class Profile(models.Model):
    """Extended user data: avatar, display name, bio and presence."""

    class Visibility(models.TextChoices):
        EVERYONE = 'everyone', 'Everyone'
        CONTACTS = 'contacts', 'Contacts'
        NOBODY = 'nobody', 'Nobody'

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='profile',
    )
    picture = models.ImageField(
        _('profile picture'),
        upload_to=profile_picture_upload_to,
        blank=True,
        null=True,
    )
    display_name = models.CharField(max_length=50, blank=True)
    bio = models.CharField(_('bio / status'), max_length=280, blank=True)
    is_online = models.BooleanField(default=False)
    last_seen = models.DateTimeField(null=True, blank=True)
    photo_visibility = models.CharField(
        max_length=10, choices=Visibility.choices, default=Visibility.EVERYONE,
    )
    about_visibility = models.CharField(
        max_length=10, choices=Visibility.choices, default=Visibility.EVERYONE,
    )
    last_seen_visibility = models.CharField(
        max_length=10, choices=Visibility.choices, default=Visibility.EVERYONE,
    )
    online_visibility = models.CharField(
        max_length=10, choices=Visibility.choices, default=Visibility.EVERYONE,
    )
    # Contact-discovery controls (Settings → Privacy → Contact discovery).
    # 'discoverable_by_phone' lets people who have this user's phone number
    # in their address book find them via contact matching; '…_by_email'
    # does the same for email matching. 'discoverable_in_suggestions' keeps
    # the user out of other people's People-You-May-Know lists entirely.
    discoverable_by_phone = models.BooleanField(default=True)
    discoverable_by_email = models.BooleanField(default=True)
    discoverable_in_suggestions = models.BooleanField(default=True)
    # Moderation restriction (admin panel): a restricted user is hidden from
    # search, contact discovery and suggestions, and nobody can start a new
    # conversation with them. Existing chats keep working; fully reversible.
    is_restricted = models.BooleanField(default=False)

    class Meta:
        indexes = [
            models.Index(fields=['is_online']),
        ]

    def __str__(self):
        return f'Profile({self.user.phone_number})'

    @property
    def avatar_url(self):
        """Picture URL or None so templates can render initials fallback.

        Points at the authenticated avatar endpoint instead of /media/ so
        pictures keep working where uploaded media is not served directly
        (e.g. ephemeral production disks).
        """
        if not self.picture:
            return None
        return f'/accounts/users/{self.user_id}/avatar/'


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_profile_for_new_user(sender, instance, created, **kwargs):
    """Every user gets a Profile automatically (idempotent)."""
    if created:
        Profile.objects.get_or_create(user=instance)


class AdminWarning(models.Model):
    """A moderation warning issued to a user from the admin panel.

    Also delivered to the recipient as a SYSTEM Notification so the user
    actually sees it in-app; the row itself is the durable record.
    """

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='admin_warnings',
    )
    issued_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='warnings_issued',
    )
    reason = models.CharField(max_length=500)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['recipient', '-created_at'])]

    def __str__(self):
        return f'Warning for {self.recipient}: {self.reason[:40]}'


class UserPreferences(models.Model):
    """Client settings synced per account (Nexus settings screen)."""

    class PresenceStatus(models.TextChoices):
        AVAILABLE = 'available', 'Available'
        BUSY = 'busy', 'Busy'
        AWAY = 'away', 'Away'
        DND = 'dnd', 'Do not disturb'
        INVISIBLE = 'invisible', 'Invisible'

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='preferences',
    )
    theme = models.CharField(max_length=10, default='dark')
    accent = models.CharField(max_length=9, default='#74ffd6')
    status = models.CharField(
        max_length=12,
        choices=PresenceStatus.choices,
        default=PresenceStatus.AVAILABLE,
    )
    enter_to_send = models.BooleanField(default=True)
    notifications_enabled = models.BooleanField(default=True)
    sounds_enabled = models.BooleanField(default=True)
    read_receipts = models.BooleanField(default=True)
    typing_indicator = models.BooleanField(default=True)
    last_seen_visible = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = 'user preferences'

    def __str__(self):
        return f'Preferences({self.user_id})'

    @classmethod
    def for_user(cls, user):
        """Return (creating if needed) the preferences row for a user."""
        prefs, _ = cls.objects.get_or_create(user=user)
        return prefs
