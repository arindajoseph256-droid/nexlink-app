"""Push notification device registry.

Stores Expo push tokens so the backend can deliver real push
notifications to the Android/iOS client whenever the user is offline.
Tokens are registered by the mobile app after login and removed on
logout. Nothing is sent unless a token was registered for that device.
"""
from django.conf import settings
from django.db import models


class PushDevice(models.Model):
    """An Expo push token belonging to one user's one device."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='push_devices',
    )
    token = models.CharField(max_length=255, unique=True, db_index=True)
    # 'expo' today; leaves room for fcm/apns later without another migration.
    platform = models.CharField(max_length=16, default='expo')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ('-updated_at',)
        indexes = [models.Index(fields=['user'])]

    def __str__(self):
        return f'PushDevice({self.user_id}, {self.platform})'
