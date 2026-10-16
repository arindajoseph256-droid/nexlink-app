"""Nexlink Admin Panel models: roles, moderation cases, announcements, audit."""
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import models
from django.db.models import Q
from django.utils import timezone

User = settings.AUTH_USER_MODEL


class AdminRole(models.TextChoices):
    SUPER_ADMIN = 'super_admin', 'Super Admin'
    ADMIN = 'admin', 'Admin'
    MODERATOR = 'moderator', 'Moderator'
    SUPPORT = 'support', 'Support'


ROLE_HIERARCHY = {
    AdminRole.SUPER_ADMIN: 4,
    AdminRole.ADMIN: 3,
    AdminRole.MODERATOR: 2,
    AdminRole.SUPPORT: 1,
}

# Django Groups used by the existing stack (rolled out by the bootstrap command).
ROLE_GROUP_NAMES = {
    AdminRole.SUPER_ADMIN: 'Nexlink Super Admin',
    AdminRole.ADMIN: 'Nexlink Admin',
    AdminRole.MODERATOR: 'Nexlink Moderator',
    AdminRole.SUPPORT: 'Nexlink Support',
}


class RoleRule(models.Model):
    """Configurable per-role permission grant (seeded by the bootstrap command).

    ``scope`` is a dotted capability string that admin API views check with
    ``roles.has_caps(user, 'users.manage', ...)``. Rows are editable by Super
    Admins so a deployment can tighten or loosen a role without a code change.
    """

    role = models.CharField(max_length=20, choices=AdminRole.choices, db_index=True)
    scope = models.CharField(max_length=60, db_index=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['role', 'scope'], name='unique_role_scope'),
        ]

    def __str__(self):
        return f'{self.role}: {self.scope}'

    @classmethod
    def seed_defaults(cls):
        """Idempotently insert the default grants for every role."""
        defaults = {
            AdminRole.SUPER_ADMIN: [
                'dashboard', 'users.view', 'users.manage', 'users.create',
                'users.delete', 'users.suspend', 'users.warn', 'users.exports',
                'reports.view', 'reports.moderate', 'reports.assign',
                'moderation.messages', 'moderation.groups', 'moderation.content',
                'announcements.send', 'administrators.view', 'administrators.manage',
                'audit.view', 'health.view', 'settings.edit',
            ],
            AdminRole.ADMIN: [
                'dashboard', 'users.view', 'users.manage', 'users.create',
                'users.suspend', 'users.warn',
                'reports.view', 'reports.moderate', 'reports.assign',
                'moderation.groups', 'announcements.send', 'administrators.view',
                'audit.view', 'health.view',
            ],
            AdminRole.MODERATOR: [
                'dashboard', 'users.view', 'users.warn', 'users.suspend',
                'reports.view', 'reports.moderate',
                'moderation.messages', 'moderation.groups', 'health.view',
            ],
            AdminRole.SUPPORT: [
                'dashboard', 'users.view', 'reports.view',
                'announcements.send', 'health.view',
            ],
        }
        for role, scopes in defaults.items():
            for scope in scopes:
                cls.objects.get_or_create(role=role, scope=scope)


def role_for_user(user):
    """Return the user's AdminRole (highest granted) or None."""
    if getattr(user, 'is_superuser', False):
        return AdminRole.SUPER_ADMIN
    names = set(user.groups.values_list('name', flat=True))
    best = None
    for role, group_name in ROLE_GROUP_NAMES.items():
        if group_name in names:
            if best is None or ROLE_HIERARCHY[role] > ROLE_HIERARCHY[best]:
                best = role
    return best


def roles_for_user(user):
    """All roles held by a user (a user can hold several)."""
    if getattr(user, 'is_superuser', False):
        return [AdminRole.SUPER_ADMIN]
    names = set(user.groups.values_list('name', flat=True))
    found = [role for role, group_name in ROLE_GROUP_NAMES.items() if group_name in names]
    return sorted(found, key=lambda r: -ROLE_HIERARCHY[r])


def has_caps(user, *required_scopes):
    """True when the user holds every required scope through any of their roles.

    Superusers always pass. Database-seeded RoleRule rows are honored so a
    deployment can tighten defaults without code changes.
    """
    if not getattr(user, 'is_authenticated', False):
        return False
    if getattr(user, 'is_superuser', False):
        return True
    user_roles = roles_for_user(user)
    if not user_roles:
        return False
    granted = set(
        RoleRule.objects.filter(role__in=user_roles).values_list('scope', flat=True),
    )
    return all(scope in granted for scope in required_scopes)


def is_admin_user(user):
    """Any staff authorization recognized by this panel."""
    return has_caps(user, 'dashboard')


class Suspension(models.Model):
    """Account suspension / deactivation record (reversible via reactivate)."""

    class Kind(models.TextChoices):
        SUSPENSION = 'suspension', 'Suspension'
        DEACTIVATION = 'deactivation', 'Permanent deactivation'

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='suspensions',
    )
    kind = models.CharField(max_length=15, choices=Kind.choices)
    reason = models.CharField(max_length=500)
    suspended_by = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='suspensions_issued',
    )
    related_report = models.ForeignKey(
        'messaging.UserReport', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='suspensions',
    )
    user_notified = models.BooleanField(default=False)
    lifted_at = models.DateTimeField(null=True, blank=True)
    lifted_by = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='suspensions_lifted',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.kind} for user {self.user_id} ({self.reason[:40]})'

    @property
    def is_active(self):
        return self.lifted_at is None


def active_suspension_for(user):
    return Suspension.objects.filter(user=user, lifted_at__isnull=True).first()


def enforce_account_user(user, require_active=True):
    """Return the active Suspension for this user, or None."""
    return active_suspension_for(user)


def apply_active_status(user, is_active, actor, kind, reason, related_report=None):
    """Set account active/inactive inside a transaction, recording a Suspension.

    Suspended accounts can no longer authenticate (is_active=False + session
    + token cleanup), and every existing session is flushed immediately.
    """
    from django.contrib.auth import get_user_model
    from django.contrib.sessions.models import Session
    from django.db import transaction
    from rest_framework.authtoken.models import Token

    User_ = get_user_model()
    with transaction.atomic():
        user.is_active = is_active
        user.save(update_fields=['is_active'])
        suspend = Suspension.objects.create(
            user=user,
            kind=kind,
            reason=(reason or '')[:500],
            suspended_by=actor,
            related_report=related_report,
            user_notified=False,
        )
        if not is_active:
            # Drop web sessions (iterate on a materialized list to avoid
            # decoding sessions after deletion).
            session_keys = list(Session.objects.values_list('session_key', flat=True))
            for key in session_keys:
                session = Session.objects.filter(session_key=key).first()
                if session and str(session.get('_auth_user_id')) == str(user.pk):
                    session.delete()
            # Drop drf tokens (mobile logout on next sync).
            Token.objects.filter(user=user).delete()
        return suspend


class ModerationCase(models.Model):
    """A report escalated into a moderation workflow (assigned, resolved)."""

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        UNDER_REVIEW = 'under_review', 'Under review'
        ACTION_REQUIRED = 'action_required', 'Action required'
        RESOLVED = 'resolved', 'Resolved'
        DISMISSED = 'dismissed', 'Dismissed'

    class Severity(models.TextChoices):
        LOW = 'low', 'Low'
        MEDIUM = 'medium', 'Medium'
        HIGH = 'high', 'High'

    report = models.OneToOneField(
        'messaging.UserReport', on_delete=models.CASCADE, related_name='case',
    )
    status = models.CharField(
        max_length=15, choices=Status.choices, default=Status.PENDING, db_index=True,
    )
    severity = models.CharField(
        max_length=10, choices=Severity.choices, default=Severity.MEDIUM,
    )
    assigned_to = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='assigned_cases',
    )
    moderator_notes = models.TextField(blank=True)
    resolution = models.TextField(blank=True)
    action_taken = models.CharField(max_length=120, blank=True)
    resolved_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='cases_resolved',
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', '-created_at']),
            models.Index(fields=['assigned_to']),
        ]

    def __str__(self):
        return f'Case #{self.pk} ({self.status}) — report {self.report_id}'

    @classmethod
    def for_report(cls, report):
        """Return (or create) the canonical case for a report idempotently."""
        case, _ = cls.objects.get_or_create(report=report)
        return case


class MessageModerationAccess(models.Model):
    """Append-only proof that a staff member opened a private conversation.

    Message content is never copied; we log who opened what and why.
    """

    staff_user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='moderation_access_records',
    )
    conversation = models.ForeignKey(
        'messaging.Conversation', on_delete=models.CASCADE,
        related_name='moderation_access_logs',
    )
    case = models.ForeignKey(
        ModerationCase, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='access_logs',
    )
    reason = models.CharField(max_length=300)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.staff_user_id} opened #{self.conversation_id} ({self.reason[:30]})'


class GroupModerationAction(models.Model):
    """Group-level moderation events (archive, clear content, member removal)."""

    class Kind(models.TextChoices):
        ARCHIVED = 'archived', 'Group archived'
        UNARCHIVED = 'unarchived', 'Group restored'
        CONTENT_CLEARED = 'content_cleared', 'Group content cleared'
        MEMBER_REMOVED = 'member_removed', 'Member removed'

    group = models.ForeignKey(
        'messaging.Conversation', on_delete=models.CASCADE,
        related_name='group_moderation_actions',
    )
    kind = models.CharField(max_length=20, choices=Kind.choices)
    performed_by = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='group_moderation_actions_taken',
    )
    reason = models.CharField(max_length=500, blank=True)
    target_user = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='group_moderation_targets',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class Announcement(models.Model):
    """Broadcast prepared by an administrator and delivered via Notification."""

    class Audience(models.TextChoices):
        ALL = 'all', 'All users'
        ACTIVE = 'active', 'Active users only'
        SUSPENDED = 'suspended', 'Suspended users only'

    title = models.CharField(max_length=150)
    body = models.TextField(max_length=2000)
    audience = models.CharField(
        max_length=12, choices=Audience.choices, default=Audience.ALL,
    )
    created_by = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='announcements_sent',
    )
    queued_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    sent_to_count = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['-queued_at']

    def __str__(self):
        return f'Announcement "{self.title}" ({self.audience})'

    def was_delivered(self):
        """Not-yet-sent (or already-sent check for the duplicate send guard)."""
        return self.sent_at is not None

    def recipients(self):
        """Resolve the audience to a queryset of users (never leaking emails)."""
        from django.contrib.auth import get_user_model

        User_ = get_user_model()
        qs = User_.objects.filter(is_staff=False, is_superuser=False)
        if self.audience == self.Audience.ACTIVE:
            qs = qs.filter(is_active=True)
        elif self.audience == self.Audience.SUSPENDED:
            qs = qs.filter(is_active=False)
        return qs


class AuditLog(models.Model):
    """Append-only audit record for admin / moderation / system actions."""

    actor = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='audit_actions',
    )
    actor_role = models.CharField(max_length=20, blank=True)
    target_user = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='audit_events_about',
    )
    action = models.CharField(max_length=60)
    target_type = models.CharField(max_length=40, blank=True)
    target_id = models.CharField(max_length=64, blank=True)
    reason = models.CharField(max_length=500, blank=True)
    case_id = models.CharField(max_length=64, blank=True)
    outcome = models.CharField(max_length=20, default='success')
    metadata = models.JSONField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name_plural = 'audit logs'
        indexes = [
            models.Index(fields=['-created_at']),
            models.Index(fields=['action']),
            models.Index(fields=['target_user']),
        ]

    def __str__(self):
        return f'{self.action} by {self.actor_id or "-"} on {self.target_type}:{self.target_id}'

    @classmethod
    def record(cls, *, actor=None, action, target_type='', target_id='',
               reason='', case_id='', outcome='success', metadata=None,
               request=None, target_user_id=None):
        """Append an audit entry; never stores passwords, tokens or bodies."""
        actor_role = ''
        if actor is not None and getattr(actor, 'is_authenticated', False):
            actor_role = role_for_user(actor) or ''
        ip_address = None
        if request is not None:
            forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
            if forwarded:
                ip_address = forwarded.split(',')[0].strip() or None
            elif request.META.get('REMOTE_ADDR'):
                ip_address = request.META.get('REMOTE_ADDR')
        safe_metadata = {}
        for key, value in (metadata or {}).items():
            key_l = str(key).lower()
            if any(secret in key_l for secret in ('password', 'token', 'secret', 'authorization')):
                continue
            safe_metadata[str(key)[:40]] = str(value)[:200]
        return cls.objects.create(
            actor=actor,
            actor_role=actor_role,
            target_user_id=target_user_id,
            action=str(action)[:60],
            target_type=str(target_type)[:40],
            target_id=str(target_id)[:64],
            reason=str(reason)[:500],
            case_id=str(case_id)[:64],
            outcome=outcome,
            metadata=safe_metadata or None,
            ip_address=ip_address,
        )


class PlatformSettings(models.Model):
    """Admin-only, single-row configuration for runtime behavior toggles."""

    registration_open = models.BooleanField(default=True)
    maintenance_mode = models.BooleanField(default=False)
    maintenance_message = models.CharField(max_length=300, blank=True)
    suspension_default_days = models.PositiveIntegerField(default=7)
    escalation_warning_threshold = models.PositiveIntegerField(default=0)
    report_categories_enabled = models.JSONField(null=True, blank=True)
    feature_announcements = models.BooleanField(default=True)
    feature_calls = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='platform_settings_updates',
    )

    class Meta:
        verbose_name_plural = 'platform settings'

    def __str__(self):
        return f'PlatformSettings(updated {self.updated_at:%Y-%m-%d %H:%M})'

    @classmethod
    def for_site(cls):
        settings_obj, _ = cls.objects.get_or_create(pk=1)
        return settings_obj


class EscalationRule(models.Model):
    """Explicit, configurable warning→suspension escalation (no implicit ban)."""

    warning_count = models.PositiveIntegerField(
        unique=True,
        help_text='When a user receives their Nth warning, trigger this rule.',
    )
    action = models.CharField(
        max_length=20,
        choices=[
            ('warn_only', 'Warn only'),
            ('notify_normal', 'Notify (no enforcement)'),
            ('suggest_suspension', 'Flag up to admins (suggest suspension)'),
            ('auto_suspend', 'Auto-suspend (dispatched per policy)'),
        ],
        default='suggest_suspension',
    )
    duration_days = models.PositiveIntegerField(
        null=True, blank=True,
        help_text='For auto_suspend: suspension length. Blank = until reviewed.',
    )
    enabled = models.BooleanField(default=False)

    def __str__(self):
        return f'After {self.warning_count} warnings → {self.action}'
