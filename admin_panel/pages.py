"""Admin web pages (/admin-panel/) — server-rendered shell + JS app.

Also hosts the **one-time first-Super-Admin setup** (/admin-panel/setup/):

- While no Super Admin exists, visiting /admin-panel/ redirects to the setup
  prompt, which offers a single form to create the first Super Admin account.
- On success the account is created (roles/groups/capability rules seeded
  exactly like `manage.py bootstrap_admin`), the creator is signed in and
  dropped straight into the dashboard.
- The moment one Super Admin exists the endpoint closes permanently: the
  prompt disappears and the page redirects away, so it can never be used to
  mint another admin.

Safety: works only when there is no Super Admin, requires a CSRF-protected
POST, runs in one transaction with a re-check inside it, validates the phone
number (E.164) and password (Django validators), and throttles attempts
per IP.
"""
from functools import wraps

from django import forms
from django.contrib.auth import get_backends, get_user_model, login
from django.contrib.auth.models import Group
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.views import redirect_to_login
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.db import transaction
from django.http import HttpResponseForbidden
from django.shortcuts import redirect, render, reverse
from django.views.decorators.cache import never_cache

from accounts.phones import normalize_e164

from .models import (
    AdminRole,
    PlatformSettings,
    ROLE_GROUP_NAMES,
    RoleRule,
    has_caps,
)

User = get_user_model()

# Brute-force guard for the public setup endpoint (per-IP, cache-backed).
SETUP_ATTEMPT_LIMIT = 15
SETUP_ATTEMPT_WINDOW = 600  # seconds


def setup_needed():
    """True while no Super Admin exists → the one-time prompt is active."""
    return not User.objects.filter(is_superuser=True).exists()


def admin_page_required(view):
    """Anonymous → login; signed-in without admin caps → branded 403.

    While no Super Admin exists, everyone without admin caps is sent to the
    one-time setup prompt instead of a dead end.
    """
    @wraps(view)
    def _wrapped(request, *args, **kwargs):
        if setup_needed() and not has_caps(request.user, 'dashboard'):
            return redirect('admin_panel_setup')
        if not request.user.is_authenticated:
            return redirect_to_login(request.get_full_path(), login_url=reverse('accounts:login'))
        if not has_caps(request.user, 'dashboard'):
            return HttpResponseForbidden('Administrator access required.')
        return view(request, *args, **kwargs)

    return _wrapped


@admin_page_required
def admin_home(request):
    """Single-page admin shell: all sections render via /api/admin/*."""
    return render(request, 'admin_panel/dashboard.html', {
        'seo_noindex': True,
    })


class SetupError(Exception):
    """Recoverable, user-facing failure while creating the first admin."""


class AdminSetupForm(forms.Form):
    """One-time form for creating the very first Super Admin account."""

    phone_number = forms.CharField(
        max_length=32,
        label='Phone number',
        help_text='Used to sign in. Include country code, e.g. +1 415 555 0100.',
    )
    first_name = forms.CharField(max_length=30, required=False, label='First name')
    email = forms.EmailField(required=False, label='Email (optional)')
    password = forms.CharField(
        widget=forms.PasswordInput,
        label='Password',
        help_text='At least 8 characters — a passphrase beats a short scramble.',
    )
    password_confirm = forms.CharField(
        widget=forms.PasswordInput,
        label='Confirm password',
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        placeholders = {
            'phone_number': '+1 415 555 0100',
            'first_name': 'Alex',
            'email': 'admin@example.com',
        }
        autocomplete = {
            'phone_number': 'tel',
            'first_name': 'given-name',
            'email': 'email',
            'password': 'new-password',
            'password_confirm': 'new-password',
        }
        for name, field in self.fields.items():
            attrs = {'class': 'admin-input', 'autocomplete': autocomplete.get(name, 'off')}
            if placeholders.get(name):
                attrs['placeholder'] = placeholders[name]
            field.widget.attrs.update(attrs)

    def clean_phone_number(self):
        phone = normalize_e164(self.cleaned_data['phone_number'])
        if User.objects.filter(phone_number=phone, is_superuser=True).exists():
            raise ValidationError('A Super Admin already uses this phone number.')
        return phone

    def clean_password(self):
        password = self.cleaned_data['password']
        validate_password(password)
        return password

    def clean(self):
        cleaned = super().clean()
        password = cleaned.get('password')
        confirm = cleaned.get('password_confirm')
        if password and confirm and password != confirm:
            self.add_error('password_confirm', 'The two passwords do not match.')
        email = cleaned.get('email')
        if email and User.objects.filter(email__iexact=email).exists():
            self.add_error('email', 'An account with this email already exists.')
        return cleaned


class AdminSetupThrottle:
    """Tiny cache-backed attempt limiter (no external dependency)."""

    def __init__(self, ip):
        self.key = f'admin-setup-attempts:{ip}'

    @property
    def blocked(self):
        return (cache.get(self.key) or 0) >= SETUP_ATTEMPT_LIMIT

    def record_failure(self):
        count = cache.get(self.key, 0) + 1
        cache.set(self.key, count, SETUP_ATTEMPT_WINDOW)


def _create_first_super_admin(data):
    """Atomically seed roles/settings and create the first Super Admin.

    The existence of a Super Admin is re-checked *inside* the transaction so
    a concurrent request cannot mint a second one.
    """
    with transaction.atomic():
        if not setup_needed():
            raise SetupError('A Super Admin already exists — the setup page is closed.')

        groups = {}
        for role_name in ROLE_GROUP_NAMES.values():
            groups[role_name], _ = Group.objects.get_or_create(name=role_name)

        RoleRule.seed_defaults()
        PlatformSettings.for_site()

        user = User.objects.select_for_update().filter(
            phone_number=data['phone_number'],
        ).first()
        if user is None:
            user = User.objects.create_user(
                phone_number=data['phone_number'],
                password=data['password'],
                email=data['email'] or None,
                first_name=data['first_name'].strip()[:30],
            )
        else:
            # An existing account may be promoted, but only by someone who
            # already knows its password.
            if not user.check_password(data['password']):
                raise SetupError(
                    'An account with this phone number already exists. '
                    'Enter its current password to promote it, or use a different number.',
                )
            try:
                validate_password(data['password'], user=user)
            except ValidationError as exc:
                raise SetupError(f'Weak password: {"; ".join(exc.messages)}')

        user.is_staff = True
        user.is_superuser = True
        user.is_active = True
        user.save(update_fields=['is_staff', 'is_superuser', 'is_active'])
        user.groups.add(groups[ROLE_GROUP_NAMES[AdminRole.SUPER_ADMIN]])

        profile = getattr(user, 'profile', None)
        if data['first_name'].strip() and profile is not None:
            profile.display_name = data['first_name'].strip()[:50]
            profile.save(update_fields=['display_name'])

    return user


@never_cache
def admin_setup(request):
    """One-time first-Super-Admin prompt. Closes permanently once one exists."""
    if not setup_needed():
        # The prompt has served its purpose: send admins to the dashboard,
        # everyone else to the normal login page.
        if request.user.is_authenticated and has_caps(request.user, 'dashboard'):
            return redirect('admin_panel_home')
        return redirect_to_login(request.get_full_path(), login_url=reverse('accounts:login'))

    throttle = AdminSetupThrottle(request.META.get('REMOTE_ADDR', 'unknown'))

    if request.method == 'POST':
        if throttle.blocked:
            form = AdminSetupForm(request.POST)
            form.add_error(None, 'Too many attempts from this address. Try again in a few minutes.')
            return render(request, 'admin_panel/setup.html', {
                'form': form,
                'seo_noindex': True,
            }, status=429)

        form = AdminSetupForm(request.POST)
        if form.is_valid():
            try:
                user = _create_first_super_admin(form.cleaned_data)
            except SetupError as exc:
                form.add_error(None, str(exc))
            except Exception:  # never leak internals on a public page
                throttle.record_failure()
                form.add_error(None, 'Setup failed unexpectedly. Please try again.')
            else:
                backend = get_backends()[0]
                user.backend = f'{backend.__class__.__module__}.{backend.__class__.__name__}'
                login(request, user)
                return redirect('admin_panel_home')
        else:
            throttle.record_failure()
    else:
        form = AdminSetupForm()

    return render(request, 'admin_panel/setup.html', {
        'form': form,
        'seo_noindex': True,
    })