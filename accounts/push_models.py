"""Push notification device registry.

Two delivery channels share one registry pattern:

- PushDevice: Expo push tokens for the Android/iOS APK (delivered through
  Expo's push API, which fans out to FCM/APNs).
- WebPushSubscription: per-browser Web Push subscriptions (delivered
  through the standard Web Push protocol with our VAPID key pair), so
  Chrome desktop, Android Chrome and installed PWAs get real OS
  notifications even when every Nexlink tab is closed.

VapidKey stores the server-side signing key pair. It is generated once
(automatically on first use) and never rotated quietly — rotating it
silently invalidates every existing subscription.
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


class WebPushSubscription(models.Model):
    """A single browser's Web Push subscription for one user.

    endpoint is unique per browser profile; a re-subscribe (with fresh
    encryption keys) simply overwrites it via save().
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='web_push_subscriptions',
    )
    endpoint = models.URLField(max_length=1000, unique=True)
    p256dh = models.CharField(max_length=255)
    auth = models.CharField(max_length=255)
    user_agent = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ('-updated_at',)
        indexes = [models.Index(fields=['user'])]

    def __str__(self):
        return f'WebPushSubscription({self.user_id}, {self.endpoint[:40]}…)'


class VapidKey(models.Model):
    """Singleton-ish store for the Web Push VAPID signing key pair."""

    name = models.CharField(max_length=32, unique=True, default='default')
    private_pem = models.TextField()

    class Meta:
        verbose_name = 'VAPID key'
        verbose_name_plural = 'VAPID keys'

    def __str__(self):
        return f'VapidKey({self.name})'
