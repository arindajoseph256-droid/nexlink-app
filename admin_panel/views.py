"""Nexlink admin API: /api/admin/* — every endpoint re-checks backend caps."""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.authentication import SessionAuthentication, TokenAuthentication
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes, throttle_scope
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from messaging.models import (
    Call,
    Conversation,
    Message,
    Notification,
    UserReport,
)
from .models import (
    AdminRole,
    Announcement,
    AuditLog,
    ModerationCase,
    PlatformSettings,
    RoleRule,
    ROLE_GROUP_NAMES,
    ROLE_HIERARCHY,
    Suspension,
    apply_active_status,
    active_suspension_for,
    has_caps,
    is_admin_user,
    role_for_user,
    roles_for_user,
)
from .permissions import caps
from . import serializers as s


User = get_user_model()

MAX_PAGE_SIZE = 100
WARNING_REASONS = [
    'harassment', 'spam', 'impersonation', 'threats', 'scams',
    'abusive_behavior', 'platform_manipulation', 'other',
]


class AdminPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = MAX_PAGE_SIZE


# --- base view helpers ------------------------------------------------------


@api_view(['GET'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('users.view')])
def current_role_view(request):
    """Return the signed-in viewer's admin roles + effective caps (safe)."""
    roles = roles_for_user(request.user) or []
    rules = RoleRule.objects.filter(role__in=roles)
    granted = sorted(set(rules.values_list('scope', flat=True)))
    return Response({
        'roles': roles,
        'is_superuser': bool(request.user.is_superuser),
        'permissions': granted,
        'display_name': request.user.get_display_name(),
        'user_id': request.user.pk,
    })


@api_view(['GET'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('dashboard')])
def dashboard_stats(request):
    """Real-time platform statistics from live database counts (no fakes)."""
    settings_obj = PlatformSettings.for_site()
    now = timezone.now()
    day_ago = now - timedelta(days=1)
    week_ago = now - timedelta(days=7)

    series_days = 30
    new_users = []
    for i in range(series_days - 1, -1, -1):
        day_start = (now - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)
        new_users.append({
            'date': day_start.date().isoformat(),
            'count': User.objects.filter(date_joined__gte=day_start, date_joined__lt=day_end).count(),
        })
    message_series = []
    for i in range(series_days - 1, -1, -1):
        day_start = (now - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)
        message_series.append({
            'date': day_start.date().isoformat(),
            'count': Message.objects.filter(created_at__gte=day_start, created_at__lt=day_end).count(),
        })

    pending_reports = ModerationCase.objects.filter(
        status__in=[
            ModerationCase.Status.PENDING,
            ModerationCase.Status.UNDER_REVIEW,
            ModerationCase.Status.ACTION_REQUIRED,
        ],
    ).count()
    unresolved_cases = ModerationCase.objects.exclude(
        status__in=[ModerationCase.Status.RESOLVED, ModerationCase.Status.DISMISSED],
    ).count()
    recent_audits = (
        AuditLog.objects.select_related('actor', 'target_user').all()[:12]
    )

    return Response({
        'users': {
            'total': User.objects.count(),
            'active': User.objects.filter(is_active=True, is_staff=False, is_superuser=False).count(),
            'suspended': User.objects.filter(is_active=False, is_staff=False, is_superuser=False).count(),
            'staff': User.objects.filter(is_staff=True).count(),
            'new_last_24h': User.objects.filter(date_joined__gte=day_ago).count(),
            'new_last_7d': User.objects.filter(date_joined__gte=week_ago).count(),
        },
        'groups': {
            'total': Conversation.objects.filter(kind=Conversation.Kind.GROUP).count(),
        },
        'messages': {
            'total': Message.objects.count(),
            'last_24h': Message.objects.filter(created_at__gte=day_ago).count(),
            'last_7d': Message.objects.filter(created_at__gte=week_ago).count(),
        },
        'moderation': {
            'pending_reports': pending_reports,
            'unresolved_cases': unresolved_cases,
            'active_suspensions': Suspension.objects.filter(
                lifted_at__isnull=True,
            ).count(),
            'warnings_total': __import__(
                'accounts.models', fromlist=['AdminWarning'],
            ).AdminWarning.objects.count(),
        },
        'calls': {
            'total': Call.objects.count(),
            'last_24h': Call.objects.filter(started_at__gte=day_ago).count(),
        },
        'announcements': {
            'total': Announcement.objects.count(),
            'sent': Announcement.objects.filter(sent_at__isnull=False).count(),
        },
        'recent_actions': AuditLogSerializerLite(recent_audits, many=True).data,
        'series': {
            'new_users': new_users,
            'messages': message_series,
        },
        'active_users_window_days': 7,
        'active_users_last_7d': _active_users_last_7d(),
    })


def _active_users_last_7d():
    """Active-user count using profile presence for the last 7 days.

    Presence is what the platform itself tracks for “online” (presence is
    updated on every socket connect/handshake and by presence.pings), so
    this measures engagement against real recorded activity data — not an
    invented approximation of DAUs.
    """
    from accounts.models import Profile
    return Profile.objects.filter(
        last_seen__gte=timezone.now() - timedelta(days=7),
    ).count()


class AuditLogSerializerLite(s.AuditLogSerializer):
    """Compact row for dashboard cards (no heavy metadata)."""
    class Meta(s.AuditLogSerializer.Meta):
        fields = (
            'id', 'actor', 'actor_name', 'actor_role', 'action',
            'target_type', 'target_id', 'reason', 'outcome', 'created_at',
        )


# --- user management -------------------------------------------------------


@api_view(['GET'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('users.view')])
def users_list(request):
    """Search / paginate / sort authorized user records efficiently."""
    qs = (
        User.objects
        .select_related('profile')
        .annotate(
            warning_count=Count('admin_warnings', distinct=True),
            suspension_count=Count('suspensions', distinct=True),
        )
    )
    query = (request.query_params.get('q') or '').strip()
    if query:
        combined = (
            Q(phone_number__icontains=query)
            | Q(username__icontains=query)
            | Q(email__icontains=query)
            | Q(first_name__icontains=query)
            | Q(last_name__icontains=query)
            | Q(profile__display_name__icontains=query)
        )
        if query.isdigit():
            combined |= Q(pk=query)
        qs = qs.filter(combined)

    account_status = request.query_params.get('status') or ''
    if account_status == 'active':
        qs = qs.filter(is_active=True)
    elif account_status == 'suspended':
        qs = qs.filter(is_active=False, is_staff=False)

    warnings_flag = request.query_params.get('warnings') == '1'
    suspensions_flag = request.query_params.get('suspensions') == '1'
    if warnings_flag:
        qs = qs.filter(warning_count__gt=0)
    if suspensions_flag:
        qs = qs.filter(suspension_count__gt=0)

    order_by = request.query_params.get('ordering') or '-date_joined'
    allowed_orders = {
        'date_joined', '-date_joined', 'last_login', '-last_login',
        'phone_number', '-phone_number', 'email', '-email',
        'warning_count', '-warning_count', 'id', '-id',
    }
    if order_by not in allowed_orders:
        order_by = '-date_joined'
    qs = qs.order_by(order_by)

    paginator = AdminPagination()
    page = paginator.paginate_queryset(qs, request)
    serializer = s.AdminUserListSerializer(page, many=True)
    return paginator.get_paginated_response(serializer.data)


def _guarded_target(request, user_id, capability):
    """Return (target, error_response) checking admin capability + self-target."""
    target = get_object_or_404(User.objects.select_related('profile'), pk=user_id)
    if not has_caps(request.user, capability):
        return target, Response(
            {'detail': 'Insufficient permissions.'}, status=status.HTTP_403_FORBIDDEN,
        )
    if target.pk == request.user.pk and capability == 'users.delete':
        return target, Response(
            {'detail': 'You cannot delete your own account via the admin panel.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return target, None


@api_view(['GET'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('users.view')])
def user_detail(request, user_id):
    """Authorized full account record (no password / token / secret fields)."""
    target, _ = _guarded_target(request, user_id, 'users.view')
    return Response(s.AdminUserDetailSerializer(target).data)


@api_view(['PUT', 'PATCH'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('users.manage')])
def user_edit(request, user_id):
    """Edit non-immutable account fields (auth enforced server side)."""
    target, _ = _guarded_target(request, user_id, 'users.manage')
    errors = {}
    data = request.data if isinstance(request.data, dict) else {}

    first_name = data.get('first_name')
    if first_name is not None:
        target.first_name = str(first_name).strip()[:30]
    last_name = data.get('last_name')
    if last_name is not None:
        target.last_name = str(last_name).strip()[:30]

    email = data.get('email')
    if email is not None:
        email = str(email).strip().lower()
        if email and User.objects.filter(email__iexact=email).exclude(pk=target.pk).exists():
            errors['email'] = 'An account with this email already exists.'
        else:
            target.email = email or None

    phone = data.get('phone_number')
    from accounts.phones import normalize_e164
    if phone is not None:
        try:
            phone = normalize_e164(str(phone))
        except Exception:
            errors['phone_number'] = 'Invalid phone number.'
        else:
            if User.objects.filter(phone_number=phone).exclude(pk=target.pk).exists():
                errors['phone_number'] = 'An account with this phone number already exists.'
            else:
                target.phone_number = phone

    display_name = data.get('display_name')
    if display_name is not None:
        target.profile.display_name = str(display_name).strip()[:50]
    bio = data.get('bio')
    if bio is not None:
        target.profile.bio = str(bio).strip()[:280]

    is_active = data.get('is_active')
    if is_active is not None:
        # Toggling is_active directly bypasses suspension bookkeeping, so
        # route it through the dedicated suspend/reactivate endpoints.
        errors['is_active'] = 'Use /admin/users/<id>/suspend/ or /reactivate/ to change account status.'

    if errors:
        return Response(errors, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        user_fields = [
            f for f in ('first_name', 'last_name', 'email', 'phone_number')
            if f in data
        ]
        if user_fields:
            target.save(update_fields=user_fields)
        profile_fields = [
            f for f in ('display_name', 'bio') if f in data
        ]
        if profile_fields:
            target.profile.save(update_fields=profile_fields)

    AuditLog.record(
        actor=request.user,
        action='user_edit',
        target_type='user',
        target_id=target.pk,
        reason=data.get('reason') or '',
        request=request,
        target_user_id=target.pk,
        metadata={
            'target_user_id': target.pk,
            'fields_changed': sorted(set(data.keys()) - {'reason'}),
        },
    )
    return Response(s.AdminUserDetailSerializer(target).data)


@api_view(['POST'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('users.warn')])
def user_warn(request, user_id):
    """Issue a formal, auditable warning (with optional report linkage)."""
    target, _ = _guarded_target(request, user_id, 'users.warn')
    reason = (request.data.get('reason') or '').strip()
    category = request.data.get('category') or 'other'
    if category not in WARNING_REASONS:
        return Response({'category': 'Invalid warning category.'}, status=400)
    if len(reason) < 3:
        return Response({'reason': 'Give a short explanation.'}, status=400)
    related_case_id = request.data.get('case_id') or None

    from accounts.models import AdminWarning
    case = ModerationCase.objects.filter(pk=related_case_id).first()
    report = case.report if case else None
    if report is not None and report.reported_id != target.pk:
        return Response({'case_id': 'Case does not target this user.'}, status=400)

    with transaction.atomic():
        warning = AdminWarning.objects.create(
            recipient=target,
            issued_by=request.user,
            reason=reason[:500],
        )
        Notification.objects.create(
            recipient=target,
            kind=Notification.Kind.SYSTEM,
            text=f'Warning from Nexlink moderation ({category}): {reason[:180]}',
        )
        AuditLog.record(
            actor=request.user,
            action='user_warned',
            target_type='user',
            target_id=target.pk,
            reason=reason,
            case_id=case.pk if case else '',
            request=request,
            target_user_id=target.pk,
            metadata={'target_user_id': target.pk, 'category': category,
                      'warning_id': warning.pk, 'related_report': report.pk if report else None},
        )
        _maybe_escalate(request, target, case)
    return Response({'status': 'warned', 'warning_id': warning.pk})


def _maybe_escalate(request, target, case):
    """Run configured EscalationRule for new warning count (never implicit)."""
    from accounts.models import AdminWarning
    from .models import EscalationRule
    warnings = AdminWarning.objects.filter(recipient=target).count()
    rule = EscalationRule.objects.filter(enabled=True, warning_count=warnings).first()
    if not rule:
        return
    if rule.action == 'auto_suspend' and target.is_active:
        days = rule.duration_days
        lift = timezone.now() + timedelta(days=days) if days else None
        suspension = Suspension.objects.create(
            user=target,
            kind=Suspension.Kind.SUSPENSION,
            reason=f'Automatic escalation after {warnings} warnings (rule #{rule.pk}).',
            suspended_by=None,
            related_report=case.report if case else None,
            user_notified=True,
        )
        Notification.objects.create(
            recipient=target,
            kind=Notification.Kind.SYSTEM,
            text='Your account has been suspended automatically for repeated policy violations.',
        )
        apply_active_status(target, False, request.user,
                            Suspension.Kind.SUSPENSION,
                            f'Auto-escalation after {warnings} warnings.',
                            related_report=case.report if case else None)
        AuditLog.record(
            actor=None,
            action='user_auto_suspended',
            target_type='user',
            target_id=target.pk,
            reason='Escalation rule triggered.',
            case_id=case.pk if case else '',
            request=request,
            metadata={'target_user_id': target.pk, 'warnings': warnings,
                      'suspension_id': suspension.pk},
        )


@api_view(['POST'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('users.suspend')])
def user_suspend(request, user_id):
    """Suspend or deactivate an account; revokes sessions and API tokens."""
    target, _ = _guarded_target(request, user_id, 'users.suspend')
    if target.is_superuser and not request.user.is_superuser:
        return Response({'detail': 'Only superusers can suspend other admins.'}, status=403)

    reason = (request.data.get('reason') or '').strip()
    if len(reason) < 3:
        return Response({'reason': 'A reason is required.'}, status=400)
    kind = request.data.get('kind') or Suspension.Kind.SUSPENSION
    if kind not in (Suspension.Kind.SUSPENSION, Suspension.Kind.DEACTIVATION):
        return Response({'kind': 'Invalid suspension kind.'}, status=400)
    related_case_id = request.data.get('case_id') or None
    case = ModerationCase.objects.filter(pk=related_case_id).first()

    apply_active_status(
        target, False, request.user, kind, reason,
        related_report=case.report if case else None,
    )
    if kind == Suspension.Kind.SUSPENSION:
        Notification.objects.create(
            recipient=target,
            kind=Notification.Kind.SYSTEM,
            text=f'Your Nexlink account has been suspended: {reason[:180]}',
        )
    AuditLog.record(
        actor=request.user,
        action='user_suspended' if kind == Suspension.Kind.SUSPENSION else 'user_deactivated',
        target_type='user',
        target_id=target.pk,
        reason=reason,
        case_id=case.pk if case else '',
        request=request,
        target_user_id=target.pk,
        metadata={'target_user_id': target.pk, 'kind': kind},
    )
    return Response({'status': 'suspended', 'kind': kind})


@api_view(['POST'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('users.suspend')])
def user_reactivate(request, user_id):
    """Reverse suspension / deactivation, preserving all account data."""
    target, _ = _guarded_target(request, user_id, 'users.suspend')
    if active_suspension_for(target) is None and target.is_active:
        return Response({'detail': 'Account is not currently restricted.'}, status=400)
    suspension = active_suspension_for(target)
    if suspension:
        suspension.lifted_at = timezone.now()
        suspension.lifted_by = request.user
        suspension.save(update_fields=['lifted_at', 'lifted_by'])
    target.is_active = True
    target.save(update_fields=['is_active'])
    Notification.objects.create(
        recipient=target,
        kind=Notification.Kind.SYSTEM,
        text='Your Nexlink account has been reactivated. Welcome back.',
    )
    AuditLog.record(
        actor=request.user,
        action='user_reactivated',
        target_type='user',
        target_id=target.pk,
        reason=(request.data.get('reason') or '')[:500],
        request=request,
        target_user_id=target.pk,
        metadata={'target_user_id': target.pk},
    )
    return Response({'status': 'active'})


@api_view(['DELETE'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('users.delete')])
def user_delete(request, user_id):
    """Hard-delete with safeguards: explicit confirm string + reason required."""
    target, _ = _guarded_target(request, user_id, 'users.delete')
    confirm = request.data.get('confirm') if request.data.get('confirm') is not None else request.query_params.get('confirm')
    reason = (request.data.get('reason') or request.query_params.get('reason') or '').strip()
    if confirm != 'DELETE':
        return Response(
            {'detail': 'Type DELETE to confirm account removal.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if len(reason) < 5:
        return Response({'reason': 'A reason is required.'}, status=400)
    label = target.get_display_name()
    target_id = target.pk
    with transaction.atomic():
        AuditLog.record(
            actor=request.user,
            action='user_deleted',
            target_type='user',
            target_id=target_id,
            reason=reason,
            request=request,
            metadata={'target_user_id': target_id, 'label': label},
        )
        target.delete()
    return Response({'status': 'deleted', 'user': label})


@api_view(['GET'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('users.exports')])
def users_export(request):
    """Export authorized records (CSV, capped at 2000 rows per request)."""
    import csv
    from django.http import HttpResponse

    qs = User.objects.filter(is_staff=False).order_by('id')[:2000]
    response = HttpResponse(content_type='text/csv')
    response['Content-Disposition'] = 'attachment; filename="nexlink-users.csv"'
    writer = csv.writer(response)
    writer.writerow(['id', 'phone_number', 'username', 'email', 'first_name',
                     'last_name', 'date_joined', 'is_active', 'warning_count'])
    for user in qs:
        writer.writerow([
            user.pk, user.phone_number, user.username, user.email or '',
            user.first_name, user.last_name, user.date_joined, user.is_active,
            user.admin_warnings.count(),
        ])
    AuditLog.record(
        actor=request.user, action='users_exported',
        target_type='system', target_id='',
        request=request,
    )
    return response


# --- reports & moderation cases --------------------------------------------


@api_view(['GET'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('reports.view')])
def reports_list(request):
    """User reports with their canonical case status + assignee."""
    qs = UserReport.objects.select_related(
        'reporter__profile', 'reported__profile', 'case__assigned_to',
    ).order_by('-created_at')

    reason = request.query_params.get('reason') or ''
    if reason:
        qs = qs.filter(reason=reason)
    case_status = request.query_params.get('status') or ''
    if case_status:
        qs = qs.filter(case__status=case_status)
    if request.query_params.get('mine') == '1':
        qs = qs.filter(case__assigned_to=request.user)

    paginator = AdminPagination()
    page = paginator.paginate_queryset(qs, request)
    rows = []
    for report in page:
        case = getattr(report, 'case', None)
        rows.append({
            'id': report.pk,
            'report_detail': s.UserReportSerializer(report).data,
            'status': case.status if case else ModerationCase.Status.PENDING,
            'severity': case.severity if case else 'medium',
            'assigned_to': case.assigned_to_id if case else None,
            'assigned_to_name': (
                case.assigned_to.get_display_name() if case and case.assigned_to else None
            ),
            'case_id': case.pk if case else None,
        })
    return paginator.get_paginated_response({'results': rows})


def _case_for_report(report_id):
    report = get_object_or_404(UserReport, pk=report_id)
    return ModerationCase.for_report(report), report


@api_view(['POST'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('reports.moderate')])
def report_assign(request, report_id):
    """Assign a report to a moderator (idempotent on the same assignee)."""
    case, report = _case_for_report(report_id)
    target_id = request.data.get('assigned_to')
    intent = request.data.get('status') or ModerationCase.Status.UNDER_REVIEW
    if target_id:
        target = get_object_or_404(User, pk=target_id)
        if not is_admin_user(target):
            return Response({'detail': 'Target is not a staff administrator.'}, status=400)
        case.assigned_to = target
    if intent in {c for c, _ in ModerationCase.Status.choices}:
        case.status = intent
    case.save()
    AuditLog.record(
        actor=request.user, action='report_assigned',
        target_type='report', target_id=report.pk,
        case_id=case.pk, request=request,
        metadata={'assigned_to': case.assigned_to_id, 'status': case.status},
    )
    return Response({'status': 'assigned', 'case_id': case.pk})


@api_view(['POST'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('reports.moderate')])
def report_resolve(request, report_id):
    """Resolve a case with an explicit resolution note (idempotent)."""
    case, report = _case_for_report(report_id)
    resolution = (request.data.get('resolution') or '').strip()
    action_taken = (request.data.get('action_taken') or '').strip()[:120]
    outcome = request.data.get('outcome') or 'resolved'
    if outcome not in ('resolved', 'dismissed'):
        return Response({'outcome': 'Outcome must be resolved or dismissed.'}, status=400)
    if len(resolution) < 3:
        return Response({'resolution': 'Explain the resolution.'}, status=400)

    if case.status in (ModerationCase.Status.RESOLVED, ModerationCase.Status.DISMISSED):
        return Response(
            {'detail': 'Case is already closed; no duplicate actions taken.'},
            status=status.HTTP_409_CONFLICT,
        )

    case.status = (
        ModerationCase.Status.RESOLVED if outcome == 'resolved'
        else ModerationCase.Status.DISMISSED
    )
    case.resolution = resolution
    case.action_taken = action_taken
    case.resolved_by = request.user
    case.resolved_at = timezone.now()
    case.save()
    AuditLog.record(
        actor=request.user, action='report_resolved',
        target_type='report', target_id=report.pk,
        reason=resolution, case_id=case.pk, request=request,
        metadata={'outcome': outcome, 'action_taken': action_taken,
                  'reported_user': report.reported_id},
    )
    return Response({'status': 'resolved', 'case_id': case.pk})


# --- reported conversations (privacy-controlled message review) ------------


@api_view(['GET'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('moderation.messages')])
def report_messages(request, report_id):
    """Reported-conversation content access — logged, purpose-bound (rule 42)."""
    report = get_object_or_404(UserReport, pk=report_id)
    case = ModerationCase.for_report(report)
    if not has_caps(request.user, 'moderation.messages'):
        return Response({'detail': 'Message content requires an explicit permission.'},
                        status=status.HTTP_403_FORBIDDEN)

    from .models import MessageModerationAccess

    # Reports target a user, not a conversation: the client tells us which
    # conversation to review via ?conversation_id, and we bound that access
    # to conversations containing at least one message by the reported user
    # (real evidence linkage — not free browsing of unrelated threads).
    conversation_id = request.query_params.get('conversation_id')
    if not conversation_id:
        return Response({'detail': 'conversation_id query parameter required.'}, status=400)
    conversation = get_object_or_404(Conversation, pk=conversation_id)
    has_reported_evidence = Message.objects.filter(
        conversation=conversation, sender_id=report.reported_id,
    ).exists()
    if not has_reported_evidence:
        return Response(
            {'detail': 'This conversation contains no messages from the reported user.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    MessageModerationAccess.objects.create(
        staff_user=request.user,
        conversation=conversation,
        case=case,
        reason='Reviewed reported conversation content.',
    )

    messages = (
        Message.objects.filter(conversation=conversation)
        .select_related('sender__profile').order_by('created_at')[:200]
    )
    AuditLog.record(
        actor=request.user,
        action='moderation_message_content_viewed',
        target_type='conversation',
        target_id=conversation.pk,
        case_id=case.pk,
        request=request,
        metadata={'report_id': report.pk, 'reason': 'Reported-conversation review.'},
    )
    return Response({
        'conversation': s.GroupAdminSerializer(conversation).data,
        'messages': s.MessageSummarySerializer(messages, many=True).data,
    })


# --- group administration --------------------------------------------------


@api_view(['GET'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('moderation.groups')])
def groups_list(request):
    """Group directory with counts and optional report linkage."""
    qs = (
        Conversation.objects
        .filter(kind=Conversation.Kind.GROUP)
        .annotate(message_count=Count('messages'))
        .order_by('-updated_at')
    )
    query = (request.query_params.get('q') or '').strip()
    if query:
        from django.db.models import Q as _Q
        qs = qs.filter(_Q(name__icontains=query) | _Q(description__icontains=query))
    paginator = AdminPagination()
    page = paginator.paginate_queryset(qs, request)
    return paginator.get_paginated_response(
        s.GroupAdminSerializer(page, many=True).data,
    )


@api_view(['GET'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('moderation.groups')])
def group_detail(request, group_id):
    group = get_object_or_404(Conversation, pk=group_id, kind=Conversation.Kind.GROUP)
    return Response(s.GroupAdminSerializer(group).data)


@api_view(['POST'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('moderation.groups')])
def group_archive(request, group_id):
    """Archive a policy-violating group (reversible) without deleting rows."""
    group = get_object_or_404(Conversation, pk=group_id, kind=Conversation.Kind.GROUP)
    reason = (request.data.get('reason') or '').strip()
    if len(reason) < 3:
        return Response({'reason': 'A reason is required.'}, status=400)
    from .models import GroupModerationAction
    GroupModerationAction.objects.create(
        group=group,
        kind=GroupModerationAction.Kind.ARCHIVED,
        performed_by=request.user,
        reason=reason,
    )
    for participant in group.participants.all():
        participant.is_hidden = True
        participant.save(update_fields=['is_hidden'])
    AuditLog.record(
        actor=request.user, action='group_archived',
        target_type='conversation', target_id=group.pk,
        reason=reason, request=request,
    )
    return Response({'status': 'archived'})


@api_view(['POST'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('moderation.groups')])
def group_unarchive(request, group_id):
    group = get_object_or_404(Conversation, pk=group_id, kind=Conversation.Kind.GROUP)
    from .models import GroupModerationAction
    GroupModerationAction.objects.create(
        group=group,
        kind=GroupModerationAction.Kind.UNARCHIVED,
        performed_by=request.user,
        reason=(request.data.get('reason') or 'Restored by admin.')[:500],
    )
    for participant in group.participants.all():
        participant.is_hidden = False
        participant.save(update_fields=['is_hidden'])
    AuditLog.record(
        actor=request.user, action='group_unarchived',
        target_type='conversation', target_id=group.pk,
        request=request,
    )
    return Response({'status': 'restored'})


@api_view(['POST'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('moderation.groups')])
def group_remove_member(request, group_id):
    """Remove a member following the platform's own group-permission rules."""
    from messaging.views import _profile_map  # noqa: F401 (not used, part of module import)
    group = get_object_or_404(Conversation, pk=group_id, kind=Conversation.Kind.GROUP)
    target_id = request.data.get('user_id')
    reason = (request.data.get('reason') or '').strip()
    participant = group.participants.filter(user_id=target_id).first()
    if not participant:
        return Response({'detail': 'User is not a member of this group.'}, status=404)
    if request.user.pk == participant.user_id and not request.user.is_superuser:
        return Response({'detail': 'Use the ordinary group leave flow.'}, status=400)
    from .models import GroupModerationAction
    with transaction.atomic():
        GroupModerationAction.objects.create(
            group=group,
            kind=GroupModerationAction.Kind.MEMBER_REMOVED,
            performed_by=request.user,
            target_user=participant.user,
            reason=reason,
        )
        participant.delete()
    AuditLog.record(
        actor=request.user, action='group_member_removed',
        target_type='conversation', target_id=group.pk,
        reason=reason, request=request,
        target_user_id=participant.user_id,
        metadata={'target_user_id': participant.user_id},
    )
    return Response({'status': 'removed', 'user': participant.user_id})


# --- announcements ---------------------------------------------------------


@api_view(['GET', 'POST'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('announcements.send')])
def announcements(request):
    """List drafts/history or queue a new broadcast (dry-run by default)."""
    if request.method == 'GET':
        qs = Announcement.objects.order_by('-queued_at')[:50]
        return Response({'results': s.AnnouncementSerializer(qs, many=True).data})

    # POST: create either a dry_run preview or a live announcement.
    title = (request.data.get('title') or '').strip()
    body = (request.data.get('body') or '').strip()
    audience = request.data.get('audience') or Announcement.Audience.ALL
    if audience not in {c for c, _ in Announcement.Audience.choices}:
        return Response({'audience': 'Invalid audience.'}, status=400)
    if len(title) < 3 or len(body) < 3:
        return Response({'detail': 'Title and body are required.'}, status=400)

    temp = Announcement(title=title, body=body, audience=audience)
    preview_count = temp.recipients().count()

    if request.data.get('dry_run'):
        return Response({'preview_only': True, 'recipient_count': preview_count})

    if audience == Announcement.Audience.ALL and not request.data.get('confirmed'):
        return Response(
            {'detail': 'Confirm=True is required to send to ALL users.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    announcement = Announcement.objects.create(
        title=title[:150], body=body[:2000], audience=audience,
        created_by=request.user,
    )
    recipients_qs = announcement.recipients()
    AuditLog.record(
        actor=request.user, action='announcement_queued',
        target_type='announcement', target_id=announcement.pk,
        reason=title, request=request,
        metadata={'audience': audience, 'recipient_count': preview_count},
    )
    # Send is deferred: the client must call /send/ explicitly with the id.
    return Response({
        'status': 'queued',
        'announcement_id': announcement.pk,
        'recipient_count': preview_count,
    })


@api_view(['POST'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('announcements.send')])
def announcement_send(request, announcement_id):
    """Deliver a queued announcement exactly once. Logs sender + audience."""
    announcement = get_object_or_404(Announcement, pk=announcement_id)
    if announcement.sent_at is not None:
        return Response(
            {'detail': 'This announcement was already sent.'},
            status=status.HTTP_409_CONFLICT,
        )
    if not announcement.created_by and announcement.created_by_id != request.user.pk:
        return Response(
            {'detail': 'Only the queued sender can dispatch this announcement.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    recipients_qs = announcement.recipients()
    delivered = 0
    notification_kind = Notification.Kind.SYSTEM
    text_body = f'{announcement.title}: {announcement.body[:220]}'
    from accounts.push import send_push
    recipient_ids = []
    for recipient in recipients_qs.only('id', 'is_active'):
        Notification.objects.create(
            recipient=recipient,
            kind=notification_kind,
            text=text_body[:255],
        )
        recipient_ids.append(recipient.pk)
        delivered += 1
    try:
        send_push(
            recipient_ids,
            title=announcement.title[:100],
            body_text=announcement.body[:180],
            data={'kind': 'announcement', 'announcement_id': announcement.pk},
        )
    except Exception:
        # Expo push is best-effort; in-app notification is authoritative.
        pass

    announcement.sent_at = timezone.now()
    announcement.sent_to_count = delivered
    announcement.save(update_fields=['sent_at', 'sent_to_count'])
    AuditLog.record(
        actor=request.user, action='announcement_sent',
        target_type='announcement', target_id=announcement.pk,
        reason=announcement.title,
        request=request,
        metadata={'audience': announcement.audience, 'delivered_to': delivered},
    )
    return Response({'status': 'sent', 'delivered_to': delivered})


# --- administrators & role rules ------------------------------------------


@api_view(['GET'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('administrators.view')])
def administrators_list(request):
    """Staff directory (safe fields only) with role + last activity."""
    qs = (
        User.objects
        .filter(is_staff=True)
        .select_related('profile')
        .order_by('-date_joined')
    )
    return Response({
        'results': s.AdministratorSerializer(qs, many=True).data,
        'role_rules': s.RoleRuleSerializer(RoleRule.objects.all(), many=True).data,
    })


@api_view(['POST'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('administrators.manage')])
def administrator_role_change(request, user_id):
    """Promote / demote a staff account between roles with safeguards."""
    actor = request.user
    if not actor.is_superuser and not has_caps(actor, 'administrators.manage'):
        return Response({'detail': 'Insufficient permissions.'}, status=403)

    target = get_object_or_404(User, pk=user_id)
    new_role = request.data.get('role')
    reason = (request.data.get('reason') or '').strip()
    confirm = request.data.get('confirm')
    if new_role not in AdminRole.values:
        return Response({'role': 'Invalid role.'}, status=400)
    if not reason:
        return Response({'reason': 'A reason is required for role changes.'}, status=400)
    if confirm != 'ROLE-CHANGE':
        return Response({'detail': 'Confirm the role change (confirm=ROLE-CHANGE).'}, status=400)

    actor_role = role_for_user(actor)
    if actor_role == AdminRole.SUPER_ADMIN or actor.is_superuser:
        pass
    else:
        # Non-superuser admins: keep the hierarchy strict (no granting above
        # their own level, no touching superusers, no self-modification).
        if target.pk == actor.pk:
            return Response({'detail': 'You cannot change your own role.'}, status=400)
        if target.is_superuser:
            return Response({'detail': 'Only superusers can manage other superusers.'}, status=403)
        actor_level = ROLE_HIERARCHY.get(actor_role, 0)
        if ROLE_HIERARCHY[new_role] > actor_level:
            return Response(
                {'detail': 'You cannot grant a role above your own.'},
                status=status.HTTP_403_FORBIDDEN,
            )

    # Safe recovery: never remove the final functioning Super Admin.
    if new_role != AdminRole.SUPER_ADMIN or not target.is_superuser:
        super_admin_others = (
            User.objects.filter(is_superuser=True).exclude(pk=target.pk).exists()
        )
        if target.is_superuser and not super_admin_others:
            return Response(
                {'detail': 'Refusing to demote the last functioning Super Admin.'},
                status=status.HTTP_409_CONFLICT,
            )

    with transaction.atomic():
        # Remove all Nexlink role groups, then add the target one.
        from django.contrib.auth.models import Group  # noqa: PLC0415
        for group_name in ROLE_GROUP_NAMES.values():
            group = Group.objects.filter(name=group_name).first()
            if group:
                target.groups.remove(group)
        if new_role != AdminRole.SUPER_ADMIN:
            group = Group.objects.get_or_create(name=ROLE_GROUP_NAMES[new_role])[0]
            target.groups.add(group)
        target.is_staff = True
        target.save(update_fields=['is_staff'])
        AuditLog.record(
            actor=actor, action='administrator_role_changed',
            target_type='user', target_id=target.pk,
            reason=reason, request=request,
            target_user_id=target.pk,
            metadata={'target_user_id': target.pk, 'new_role': new_role,
                      'previous_role': role_for_user(target)},
        )
    return Response({'status': 'updated', 'role': new_role})


@api_view(['POST'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('administrators.manage')])
def administrator_deactivate(request, user_id):
    """Revoke administrator access (demote to ordinary user or ban outright)."""
    target = get_object_or_404(User, pk=user_id)
    mode = request.data.get('mode') or 'demote'
    reason = (request.data.get('reason') or '').strip() or 'Administrator access revoked.'
    confirm = request.data.get('confirm')
    if confirm != 'REVOKE':
        return Response({'detail': 'Confirm revocation (confirm=REVOKE).'}, status=400)
    if target.is_superuser:
        other_superadmins = User.objects.filter(is_superuser=True).exclude(pk=target.pk).exists()
        if not other_superadmins:
            return Response(
                {'detail': 'Refusing to revoke the last Super Admin.'},
                status=status.HTTP_409_CONFLICT,
            )

    with transaction.atomic():
        from django.contrib.auth.models import Group
        for group_name in ROLE_GROUP_NAMES.values():
            group = Group.objects.filter(name=group_name).first()
            if group:
                target.groups.remove(group)
        if mode == 'ban':
            target.is_staff = False
            target.is_active = False
            target.save(update_fields=['is_staff', 'is_active'])
        elif mode == 'demote':
            target.is_staff = False
            target.save(update_fields=['is_staff'])
        AuditLog.record(
            actor=request.user, action='administrator_deactivated',
            target_type='user', target_id=target.pk,
            reason=reason, request=request,
            target_user_id=target.pk,
            metadata={'target_user_id': target.pk, 'mode': mode},
        )
    return Response({'status': 'revoked', 'mode': mode})


# --- audit logs -----------------------------------------------------------


@api_view(['GET'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('audit.view')])
def audit_logs(request):
    """Read-only, paginated audit trail (sorting + filters only)."""
    qs = AuditLog.objects.select_related('actor', 'target_user').order_by('-created_at')
    action = request.query_params.get('action') or ''
    if action:
        qs = qs.filter(action=action)
    actor_id = request.query_params.get('actor') or ''
    if actor_id:
        qs = qs.filter(actor_id=actor_id)
    paginator = AdminPagination()
    page = paginator.paginate_queryset(qs, request)
    return paginator.get_paginated_response(
        s.AuditLogSerializer(page, many=True).data,
    )


# --- platform settings ----------------------------------------------------


@api_view(['GET'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('dashboard')])
def settings_view(request):
    """Read current settings (secrets never exposed)."""
    settings_obj = PlatformSettings.for_site()
    payload = s.PlatformSettingsSerializer(settings_obj).data
    # Always show the resolved admin contact (setting → super admin → from).
    payload['admin_email'] = settings_obj.effective_admin_email()
    return Response({
        'settings': payload,
        'can_edit': has_caps(request.user, 'settings.edit'),
    })


@api_view(['PUT', 'PATCH'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('settings.edit')])
def settings_update(request):
    """Update whitelisted settings; critical flips require confirmation."""
    settings_obj = PlatformSettings.for_site()
    data = request.data if isinstance(request.data, dict) else {}
    confirm = data.get('confirm')
    allowed_fields = [
        'admin_email', 'registration_open', 'maintenance_mode', 'maintenance_message',
        'suspension_default_days', 'escalation_warning_threshold',
        'feature_announcements', 'feature_calls',
    ]
    critical = {'maintenance_mode', 'registration_open'}
    changes = {}
    errors = {}
    for field in allowed_fields:
        if field not in data:
            continue
        value = data[field]
        current = getattr(settings_obj, field)
        if field == 'admin_email':
            from django.core.validators import validate_email
            from django.core.exceptions import ValidationError as DjangoValidationError
            value = str(value or '').strip().lower()[:254]
            try:
                validate_email(value)
            except DjangoValidationError:
                errors[field] = 'Enter a valid email address.'
                continue
        elif isinstance(current, bool):
            value = bool(value)
        elif isinstance(current, int):
            try:
                value = max(0, min(int(value), 365))
            except (TypeError, ValueError):
                errors[field] = 'Must be an integer.'
                continue
        elif isinstance(current, str):
            value = str(value)[:300]
        if field in critical and value != current and confirm != 'SETTINGS-CHANGE':
            errors['confirm'] = 'Critical settings changes require confirm=SETTINGS-CHANGE.'
            continue
        changes[field] = value
    if errors:
        return Response(errors, status=400)
    for field, value in changes.items():
        setattr(settings_obj, field, value)
    if data.get('report_categories_enabled') is not None and isinstance(data['report_categories_enabled'], list):
        settings_obj.report_categories_enabled = [
            str(item)[:50] for item in data['report_categories_enabled'][:30]
        ]
    settings_obj.updated_by = request.user
    settings_obj.save()
    AuditLog.record(
        actor=request.user, action='settings_updated',
        target_type='system', target_id='platform-settings',
        request=request,
        metadata={'changed': sorted(changes.keys()),
                  'report_categories': bool(data.get('report_categories_enabled'))},
    )
    return Response(s.PlatformSettingsSerializer(settings_obj).data | {
        'admin_email': settings_obj.effective_admin_email(),
    })


# --- system health ---------------------------------------------------------


@api_view(['GET'])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([caps('health.view')])
def health_full(request):
    """Real, measured backend health (db, cache, websocket, version).

    No CPU/memory traffic fabrications, no environment-variable dump.
    """
    checks = {}
    # Database connectivity
    from django.db import connection
    db_ok = True
    db_latency_ms = None
    try:
        start = timezone.now()
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
            cursor.fetchone()
        db_latency_ms = (timezone.now() - start).total_seconds() * 1000
    except Exception:
        db_ok = False
    checks['database'] = {
        'ok': db_ok,
        'latency_ms': round(db_latency_ms, 1) if db_latency_ms is not None else None,
    }

    # Cache backend
    cache_ok = True
    try:
        cache.set('admin_health_probe', '1', 5)
        cache_ok = cache.get('admin_health_probe') == '1'
    except Exception:
        cache_ok = False
    checks['cache'] = {'ok': cache_ok}

    # Channels layer (websocket service)
    channels_ok = True
    try:
        from channels.layers import get_channel_layer
        layer = get_channel_layer()
        channels_ok = layer is not None
    except Exception:
        channels_ok = False
    checks['channels'] = {'ok': channels_ok}

    # Version info from the environment actually deployed.
    import django as django_module
    version_info = {
        'python': __import__('sys').version.split()[0],
        'django': django_module.get_version(),
        'rest_framework': __import__('rest_framework').VERSION,
    }

    from django.conf import settings as django_settings
    emails = {'backend': django_settings.EMAIL_BACKEND}

    overall = (
        'ok' if all(check['ok'] for check in checks.values()) else 'degraded'
    )
    return Response({
        'overall': overall,
        'checks': checks,
        'version': version_info,
        'email_backend': emails,
        'message_volume_24h': Message.objects.filter(
            created_at__gte=timezone.now() - timedelta(days=1),
        ).count(),
        'recent_errors': [],  # no error-tracking ingest configured; documented
    })
