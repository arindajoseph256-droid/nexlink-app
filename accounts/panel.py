"""Staff-only admin panel: user list, detail/edit, warn, block, ban, delete, create.

Access rules:
- Every view requires a signed-in staff user (``is_staff``). Anonymous users
  are sent to the login page; signed-in non-staff users get 403.
- Destructive actions (hard delete, granting staff) require ``is_superuser``.
  Staff can never modify/ban/delete a superuser, and nobody can ban or
  delete themselves.
"""
from django.contrib import messages
from django.contrib.auth import get_user_model
from django.contrib.auth.views import redirect_to_login
from django.core.paginator import Paginator
from django.db.models import Count, Q
from django.http import HttpResponseForbidden
from django.shortcuts import get_object_or_404, redirect, render, reverse
from django.views.decorators.http import require_POST

from messaging.models import BlockedUser, Notification

from .models import AdminWarning
from .panel_forms import PanelUserCreateForm, PanelUserEditForm, PanelWarnForm

User = get_user_model()

PAGE_SIZE = 25


def _is_staff(user):
    return user.is_authenticated and user.is_staff


def staff_required(view):
    """Anonymous → login redirect; signed-in non-staff → 403."""
    from functools import wraps

    @wraps(view)
    def _wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return redirect_to_login(request.get_full_path(), login_url=reverse('accounts:login'))
        if not request.user.is_staff:
            return HttpResponseForbidden('Staff access required.')
        return view(request, *args, **kwargs)

    return _wrapped


PANEL_FILTERS = {
    'all': None,
    'active': Q(is_active=True),
    'banned': Q(is_active=False),
    'staff': Q(is_staff=True),
    'online': Q(profile__is_online=True),
}


@staff_required
def panel_users(request):
    """User directory: search, filters, stats and pagination."""
    users = (
        User.objects
        .select_related('profile')
        .annotate(
            blocks_issued=Count('blocked_users', distinct=True),
            blocked_by_count=Count('blocked_by', distinct=True),
            warning_count=Count('admin_warnings', distinct=True),
        )
        .order_by('-date_joined')
    )

    query = (request.GET.get('q') or '').strip()
    if query:
        users = users.filter(
            Q(first_name__icontains=query)
            | Q(last_name__icontains=query)
            | Q(username__icontains=query)
            | Q(phone_number__icontains=query)
            | Q(email__icontains=query)
            | Q(profile__display_name__icontains=query)
        )

    active_filter = request.GET.get('filter') or 'all'
    condition = PANEL_FILTERS.get(active_filter)
    if condition is not None:
        users = users.filter(condition)
    if active_filter == 'blocked':
        users = users.filter(Q(blocks_issued__gt=0) | Q(blocked_by_count__gt=0))

    stats = {
        'total': User.objects.count(),
        'active': User.objects.filter(is_active=True).count(),
        'banned': User.objects.filter(is_active=False).count(),
        'online': User.objects.filter(profile__is_online=True).count(),
        'staff': User.objects.filter(is_staff=True).count(),
    }

    paginator = Paginator(users, PAGE_SIZE)
    page = paginator.get_page(request.GET.get('page'))

    return render(request, 'accounts/panel_users.html', {
        'page_obj': page,
        'query': query,
        'active_filter': active_filter if active_filter in PANEL_FILTERS else 'all',
        'stats': stats,
        'filters': [
            ('all', 'All'), ('active', 'Active'), ('online', 'Online'),
            ('banned', 'Banned'), ('staff', 'Staff'), ('blocked', 'Blocked'),
        ],
    })


def _get_target(request, user_id):
    return get_object_or_404(User.objects.select_related('profile'), pk=user_id)


def _can_manage(actor, target):
    """Staff may manage regular users; only superusers may touch superusers."""
    return actor.is_superuser or not target.is_superuser


def _guard_target(request, target):
    """Return an error message when the actor may not manage the target."""
    if not _can_manage(request.user, target):
        return 'Only superusers can manage other admins.'
    if target.pk == request.user.pk:
        return 'You cannot perform this action on your own account.'
    return None


@staff_required
def panel_user_detail(request, user_id):
    """Full profile + editable fields + moderation actions + warning history."""
    target = _get_target(request, user_id)
    edit_form = PanelUserEditForm(
        initial={
            'first_name': target.first_name,
            'last_name': target.last_name,
            'email': target.email or '',
            'phone_number': target.phone_number,
            'display_name': target.profile.display_name,
            'bio': target.profile.bio,
        },
        user=target,
    )
    warn_form = PanelWarnForm()
    warnings = target.admin_warnings.select_related('issued_by')[:20]

    return render(request, 'accounts/panel_user_detail.html', {
        'target': target,
        'edit_form': edit_form,
        'warn_form': warn_form,
        'warnings': warnings,
        'is_restricted': target.profile.is_restricted,
        'blocks_issued': BlockedUser.objects.filter(blocker=target).count(),
        'blocked_them_count': BlockedUser.objects.filter(blocked=target).count(),
        'conversation_count': target.conversation_memberships.count(),
        'can_manage': _can_manage(request.user, target),
        'is_self': target.pk == request.user.pk,
    })


@require_POST
@staff_required
def panel_user_update(request, user_id):
    target = _get_target(request, user_id)
    if not _can_manage(request.user, target):
        messages.error(request, 'Only superusers can manage other admins.')
        return redirect('accounts:panel_user_detail', user_id=user_id)

    form = PanelUserEditForm(request.POST, user=target)
    if not form.is_valid():
        messages.error(request, ' '.join(
            [error for errors in form.errors.values() for error in errors],
        ))
        return redirect('accounts:panel_user_detail', user_id=user_id)

    data = form.cleaned_data
    target.first_name = data['first_name'].strip()[:30]
    target.last_name = data['last_name'].strip()[:30]
    target.email = data['email']
    target.phone_number = data['phone_number']
    if data['new_password']:
        target.set_password(data['new_password'])
        target.save(update_fields=['first_name', 'last_name', 'email', 'phone_number', 'password'])
    else:
        target.save(update_fields=['first_name', 'last_name', 'email', 'phone_number'])

    target.profile.display_name = data['display_name'].strip()[:50]
    target.profile.bio = data['bio'].strip()[:280]
    target.profile.save(update_fields=['display_name', 'bio'])

    messages.success(request, f'Updated {target.get_display_name()}.')
    return redirect('accounts:panel_user_detail', user_id=user_id)


@require_POST
@staff_required
def panel_user_warn(request, user_id):
    target = _get_target(request, user_id)
    if not _can_manage(request.user, target):
        messages.error(request, 'Only superusers can manage other admins.')
        return redirect('accounts:panel_user_detail', user_id=user_id)

    form = PanelWarnForm(request.POST)
    if not form.is_valid():
        messages.error(request, ' '.join(
            [error for errors in form.errors.values() for error in errors],
        ))
        return redirect('accounts:panel_user_detail', user_id=user_id)

    AdminWarning.objects.create(
        recipient=target,
        issued_by=request.user,
        reason=form.cleaned_data['reason'],
    )
    Notification.objects.create(
        recipient=target,
        kind=Notification.Kind.SYSTEM,
        text=f'Warning from Nexlink moderation: {form.cleaned_data["reason"][:200]}',
    )
    messages.success(request, f'Warning sent to {target.get_display_name()}.')
    return redirect('accounts:panel_user_detail', user_id=user_id)


@require_POST
@staff_required
def panel_user_restrict(request, user_id):
    """Toggle a platform restriction (softer than a ban).

    Restricted users stay logged in but disappear from search and contact
    discovery, and no new conversations can be started with them.
    """
    target = _get_target(request, user_id)
    error = _guard_target(request, target)
    if error:
        messages.error(request, error)
        return redirect('accounts:panel_user_detail', user_id=user_id)

    target.profile.is_restricted = not target.profile.is_restricted
    target.profile.save(update_fields=['is_restricted'])
    state = 'restricted' if target.profile.is_restricted else 'un-restricted'
    messages.success(request, f'{target.get_display_name()} {state}.')
    return redirect('accounts:panel_user_detail', user_id=user_id)


@require_POST
@staff_required
def panel_user_ban(request, user_id):
    """Toggle is_active: banned users cannot log in and their tokens fail."""
    target = _get_target(request, user_id)
    error = _guard_target(request, target)
    if error:
        messages.error(request, error)
        return redirect('accounts:panel_user_detail', user_id=user_id)

    target.is_active = not target.is_active
    target.save(update_fields=['is_active'])
    state = 'banned' if not target.is_active else 're-activated'
    messages.success(request, f'{target.get_display_name()} {state}.')
    return redirect('accounts:panel_user_detail', user_id=user_id)


@require_POST
@staff_required
def panel_user_delete(request, user_id):
    target = _get_target(request, user_id)
    if not request.user.is_superuser:
        messages.error(request, 'Only superusers can delete accounts.')
        return redirect('accounts:panel_users')
    if target.pk == request.user.pk:
        messages.error(request, 'You cannot delete your own account here.')
        return redirect('accounts:panel_user_detail', user_id=user_id)
    if request.POST.get('confirm') != 'DELETE':
        messages.error(request, 'Type DELETE to confirm account removal.')
        return redirect('accounts:panel_user_detail', user_id=user_id)

    label = target.get_display_name()
    target.delete()
    messages.success(request, f'{label} was permanently deleted.')
    return redirect('accounts:panel_users')


@staff_required
def panel_user_create(request):
    if request.method == 'POST':
        form = PanelUserCreateForm(request.POST)
        if form.is_valid():
            data = form.cleaned_data
            user = User.objects.create_user(
                phone_number=data['phone_number'],
                password=data['password'],
                email=data['email'],
                first_name=data['first_name'].strip()[:30],
                last_name=data['last_name'].strip()[:30],
            )
            user.profile.display_name = data['display_name'].strip()[:50]
            user.profile.save(update_fields=['display_name'])
            if data['make_staff'] and request.user.is_superuser:
                user.is_staff = True
                user.save(update_fields=['is_staff'])
            messages.success(request, f'Created account for {user.get_display_name()}.')
            return redirect('accounts:panel_user_detail', user_id=user.pk)
    else:
        form = PanelUserCreateForm()
    return render(request, 'accounts/panel_user_form.html', {
        'form': form,
        'can_grant_staff': request.user.is_superuser,
    })
