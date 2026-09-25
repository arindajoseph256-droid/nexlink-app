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

    class Meta:
        indexes = [
            models.Index(fields=['is_online']),
        ]

    def __str__(self):
        return f'Profile({self.user.phone_number})'

    @property
    def avatar_url(self):
        """Picture URL or None so templates can render initials fallback."""
        return self.picture.url if self.picture else None


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_profile_for_new_user(sender, instance, created, **kwargs):
    """Every user gets a Profile automatically (idempotent)."""
    if created:
        Profile.objects.get_or_create(user=instance)
