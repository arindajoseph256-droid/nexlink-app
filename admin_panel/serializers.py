"""DRF serializers for the admin API (read- and write-shaped, privacy-aware)."""
from django.contrib.auth import get_user_model
from rest_framework import serializers

from accounts.models import AdminWarning
from messaging.models import (
    Conversation,
    Message,
    Notification,
    UserReport,
)

from .models import (
    Announcement,
    AuditLog,
    ModerationCase,
    PlatformSettings,
    RoleRule,
    Suspension,
)

User = get_user_model()


class AdminUserListSerializer(serializers.ModelSerializer):
    """Safe directory row: identity + moderation counters, no credentials."""

    display_name = serializers.SerializerMethodField()
    warning_count = serializers.IntegerField(read_only=True, default=0)
    suspension_count = serializers.IntegerField(read_only=True, default=0)
    case_status = serializers.CharField(read_only=True, default='')
    role = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            'id', 'phone_number', 'username', 'email', 'first_name', 'last_name',
            'display_name', 'date_joined', 'last_login', 'is_active', 'status',
            'role', 'warning_count', 'suspension_count', 'case_status',
        )

    def get_display_name(self, obj):
        return obj.get_display_name()

    def get_role(self, obj):
        from .models import role_for_user
        return role_for_user(obj)

    def get_status(self, obj):
        if not obj.is_active:
            return 'suspended'
        return 'active'


class AdminUserDetailSerializer(AdminUserListSerializer):
    """Full authorized account record (still never password/token data)."""

    profile = serializers.SerializerMethodField()
    moderation_history = serializers.SerializerMethodField()
    restrictions = serializers.SerializerMethodField()

    class Meta(AdminUserListSerializer.Meta):
        fields = AdminUserListSerializer.Meta.fields + (
            'profile', 'moderation_history', 'restrictions',
        )

    def get_profile(self, obj):
        profile = getattr(obj, 'profile', None)
        if not profile:
            return {}
        return {
            'display_name': profile.display_name,
            'bio': profile.bio,
            'is_online': profile.is_online,
            'last_seen': profile.last_seen,
            'is_restricted': profile.is_restricted,
            'discoverable_by_phone': profile.discoverable_by_phone,
            'discoverable_by_email': profile.discoverable_by_email,
            'discoverable_in_suggestions': profile.discoverable_in_suggestions,
        }

    def get_moderation_history(self, obj):
        warnings = obj.admin_warnings.select_related('issued_by').order_by('-created_at')[:20]
        suspensions = Suspension.objects.filter(user=obj).select_related('suspended_by')[:20]
        return {
            'warnings': AdminWarningSerializer(warnings, many=True).data,
            'suspensions': SuspensionSerializer(suspensions, many=True).data,
        }

    def get_restrictions(self, obj):
        profile = getattr(obj, 'profile', None)
        if not profile:
            return {}
        return {
            'discoverable_by_phone': profile.discoverable_by_phone,
            'discoverable_by_email': profile.discoverable_by_email,
            'discoverable_in_suggestions': profile.discoverable_in_suggestions,
            'is_restricted': profile.is_restricted,
        }


class AdminWarningSerializer(serializers.ModelSerializer):
    issued_by_name = serializers.SerializerMethodField()

    class Meta:
        model = AdminWarning
        fields = ('id', 'reason', 'is_read', 'created_at', 'issued_by', 'issued_by_name')

    def get_issued_by_name(self, obj):
        return obj.issued_by.get_display_name() if obj.issued_by else None


class SuspensionSerializer(serializers.ModelSerializer):
    suspended_by_name = serializers.SerializerMethodField()
    lifted_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Suspension
        fields = (
            'id', 'kind', 'reason', 'user_notified', 'created_at',
            'lifted_at', 'suspended_by', 'suspended_by_name',
            'lifted_by', 'lifted_by_name', 'is_active',
        )

    def get_suspended_by_name(self, obj):
        return obj.suspended_by.get_display_name() if obj.suspended_by else None

    def get_lifted_by_name(self, obj):
        return obj.lifted_by.get_display_name() if obj.lifted_by else None


class UserReportSerializer(serializers.ModelSerializer):
    reporter_name = serializers.SerializerMethodField()
    reported_name = serializers.SerializerMethodField()

    class Meta:
        model = UserReport
        fields = (
            'id', 'reporter', 'reporter_name', 'reported', 'reported_name',
            'reason', 'details', 'created_at',
        )

    def get_reporter_name(self, obj):
        return obj.reporter.get_display_name()

    def get_reported_name(self, obj):
        return obj.reported.get_display_name()


class ModerationCaseSerializer(serializers.ModelSerializer):
    report = UserReportSerializer(read_only=True)
    assigned_to_name = serializers.SerializerMethodField()
    resolved_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ModerationCase
        fields = (
            'id', 'report', 'status', 'severity', 'assigned_to',
            'assigned_to_name', 'resolved_by', 'resolved_by_name',
            'moderator_notes', 'resolution', 'action_taken',
            'created_at', 'updated_at', 'resolved_at',
        )

    def get_assigned_to_name(self, obj):
        return obj.assigned_to.get_display_name() if obj.assigned_to else None

    def get_resolved_by_name(self, obj):
        return obj.resolved_by.get_display_name() if obj.resolved_by else None


class AuditLogSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = (
            'id', 'actor', 'actor_name', 'actor_role', 'action',
            'target_type', 'target_id', 'target_user', 'reason',
            'case_id', 'outcome', 'metadata', 'ip_address', 'created_at',
        )

    def get_actor_name(self, obj):
        return obj.actor.get_display_name() if obj.actor else None


class AnnouncementSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Announcement
        fields = (
            'id', 'title', 'body', 'audience', 'created_by', 'created_by_name',
            'queued_at', 'sent_at', 'sent_to_count',
        )

    def get_created_by_name(self, obj):
        return obj.created_by.get_display_name() if obj.created_by else None


class PlatformSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlatformSettings
        fields = (
            'id', 'registration_open', 'maintenance_mode', 'maintenance_message',
            'suspension_default_days', 'escalation_warning_threshold',
            'report_categories_enabled', 'feature_announcements', 'feature_calls',
            'updated_at', 'updated_by',
        )
        read_only_fields = ('id', 'updated_at', 'updated_by')


class GroupAdminSerializer(serializers.ModelSerializer):
    """Group row for the admin directory (safe fields only)."""

    member_count = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    message_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Conversation
        fields = (
            'id', 'name', 'description', 'kind', 'created_by', 'created_by_name',
            'created_at', 'updated_at', 'member_count', 'message_count',
        )

    def get_member_count(self, obj):
        return obj.participants.count()

    def get_created_by_name(self, obj):
        return obj.created_by.get_display_name() if obj.created_by else None


class AdministratorSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()
    roles = serializers.SerializerMethodField()
    last_action_at = serializers.SerializerMethodField()
    is_active_admin = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            'id', 'phone_number', 'username', 'email', 'first_name', 'last_name',
            'date_joined', 'last_login', 'is_active', 'is_staff', 'is_superuser',
            'role', 'roles', 'is_active_admin', 'last_action_at',
        )

    def get_role(self, obj):
        from .models import role_for_user
        return role_for_user(obj)

    def get_roles(self, obj):
        from .models import roles_for_user
        return roles_for_user(obj)

    def get_is_active_admin(self, obj):
        from .models import roles_for_user
        return bool(roles_for_user(obj)) and obj.is_active

    def get_last_action_at(self, obj):
        latest = AuditLog.objects.filter(actor=obj).order_by('-created_at').first()
        return latest.created_at if latest else None


class RoleRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoleRule
        fields = ('id', 'role', 'scope')


class MessageSummarySerializer(serializers.ModelSerializer):
    """Restricted view used with reported-conversation content (staff only)."""

    sender_name = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = (
            'id', 'conversation', 'sender', 'sender_name', 'body',
            'message_type', 'sent_at', 'is_deleted',
        )

    def get_sender_name(self, obj):
        return obj.sender.get_display_name()


class NotificationSerializer(serializers.ModelSerializer):
    recipient_name = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = (
            'id', 'recipient', 'recipient_name', 'kind', 'text', 'is_read', 'created_at',
        )

    def get_recipient_name(self, obj):
        return obj.recipient.get_display_name()
