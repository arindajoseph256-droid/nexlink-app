"""Account views: phone registration, phone login, profile, settings."""
from django.contrib import messages
from django.contrib.auth import login as auth_login, get_user_model
from django.contrib.auth import views as auth_views
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import PasswordChangeForm
from django.contrib.auth.views import PasswordChangeDoneView
from django.db import transaction
from functools import wraps
from django.contrib.auth.views import redirect_to_login
from django.http import FileResponse, JsonResponse
from django.shortcuts import redirect, render
from django.urls import reverse_lazy
from django.views.decorators.http import require_POST
from rest_framework.authtoken.models import Token

from .forms import (
    LoginForm,
    PhoneChangeForm,
    ProfileForm,
    RegisterForm,
    UserEmailForm,
)
from .models import derive_username_from_phone
from .phones import normalize_e164

User = get_user_model()


def _avatar_viewer(request):
    """Session user, or the DRF-Token user from ?token=<key> (native clients).

    React Native's <Image> cannot attach an Authorization header, so the
    avatar endpoint accepts the same query-token scheme as the WebSocket
    layer. Session-cookie auth (web app) is untouched.
    """
    if request.user.is_authenticated:
        return request.user
    key = (request.GET.get('token') or '').strip()
    if not key:
        return None
    token = Token.objects.select_related('user').filter(key=key).first()
    user = getattr(token, 'user', None)
    return user if user and user.is_active else None


def register_view(request):
    """Create an account immediately after validating registration details."""
    if request.user.is_authenticated:
        return redirect('messaging:conversations')

    if request.method == 'POST':
        form = RegisterForm(request.POST, request.FILES)
        if form.is_valid():
            user = form.save()
            messages.success(request, 'Welcome! Your account has been created.')
            return redirect('messaging:conversations')
    else:
        form = RegisterForm()
    return render(request, 'accounts/register.html', {'form': form})


class LoginView(auth_views.LoginView):
    """Authenticate directly with a phone number or email and password."""

    form_class = LoginForm
    template_name = 'accounts/login.html'
    redirect_authenticated_user = True

    def form_valid(self, form):
        user = form.get_user()
        remember_me = bool(form.cleaned_data.get('remember_me'))
        auth_login(self.request, user)
        self.request.session.set_expiry(1209600 if remember_me else 0)
        messages.success(self.request, f'Welcome back, {user.get_display_name()}!')
        return redirect('messaging:conversations')


class LogoutView(auth_views.LogoutView):
    """Log the user out and redirect to the login page."""

    next_page = reverse_lazy('accounts:login')


@login_required
def profile_view(request):
    """Display the user's profile page."""
    profile = request.user.profile
    return render(request, 'accounts/profile.html', {'profile': profile})


def avatar_auth_required(view_func):
    """Like @login_required, but also accepts ?token=<key> (native <Image>)."""

    @wraps(view_func)
    def _wrapped(request, *args, **kwargs):
        if _avatar_viewer(request) is None:
            if request.GET.get('token'):
                # Native client with a bad/expired token: JSON, not an HTML redirect.
                return JsonResponse({'detail': 'Invalid or expired token.'}, status=401)
            return redirect_to_login(request.get_full_path())
        return view_func(request, *args, **kwargs)

    return _wrapped


@avatar_auth_required
def avatar_view(request, user_id):
    """Serve an avatar only to authenticated viewers.

    Authentication: session cookie (web) or ?token=<key> (native <Image>).
    A missing file (e.g. after a deploy on an ephemeral disk) answers 404
    so the UI can fall back to initials instead of erroring.
    """
    from django.http import Http404
    profile = User.objects.filter(pk=user_id).values_list('profile__picture', flat=True).first()
    if not profile:
        raise Http404
    picture = User.objects.get(pk=user_id).profile.picture
    if not picture:
        raise Http404
    try:
        file_obj = picture.open('rb')
        file_obj.read(1)
        file_obj.seek(0)
    except (FileNotFoundError, OSError, ValueError):
        raise Http404
    return FileResponse(file_obj, content_type='image/*')


@login_required
@transaction.atomic
def settings_view(request):
    """Edit profile and account email."""
    profile = request.user.profile
    if request.method == 'POST':
        profile_form = ProfileForm(request.POST, request.FILES, instance=profile)
        email_form = UserEmailForm(request.POST, instance=request.user)
        if profile_form.is_valid() and email_form.is_valid():
            profile_form.save()
            email_form.save()
            messages.success(request, 'Your settings have been saved.')
            return redirect('accounts:profile')
    else:
        profile_form = ProfileForm(instance=profile)
        email_form = UserEmailForm(instance=request.user)
    return render(
        request,
        'accounts/settings.html',
        {'profile_form': profile_form, 'email_form': email_form},
    )


@login_required
def phone_change_view(request):
    """Change the account phone number directly without any verification step."""
    if request.method == 'POST':
        form = PhoneChangeForm(request.POST, initial={'current_phone': request.user.phone_number})
        if form.is_valid():
            new_phone = form.cleaned_data['new_phone_number']
            if User.objects.exclude(pk=request.user.pk).filter(phone_number=new_phone).exists():
                form.add_error('new_phone_number', 'An account with this phone number already exists.')
            else:
                request.user.phone_number = new_phone
                request.user.username = derive_username_from_phone(new_phone)
                request.user.save(update_fields=['phone_number', 'username'])
                messages.success(request, 'Your phone number has been updated.')
                return redirect('accounts:profile')
    else:
        form = PhoneChangeForm(initial={'current_phone': request.user.phone_number})
    return render(request, 'accounts/phone_change.html', {'form': form})


@login_required
def password_change_view(request):
    """Change the password of the logged-in user (keeps session)."""
    if request.method == 'POST':
        form = PasswordChangeForm(user=request.user, data=request.POST)
        if form.is_valid():
            form.save()
            messages.success(request, 'Your password has been changed.')
            return redirect('accounts:password_change_done')
    else:
        form = PasswordChangeForm(user=request.user)
    return render(request, 'accounts/password_change.html', {'form': form})


class CustomPasswordChangeDoneView(PasswordChangeDoneView):
    template_name = 'accounts/password_change_done.html'


def phone_available(request):
    """AJAX endpoint for the register page's live phone validation.

    Answers with availability only for *valid* numbers; invalid input gets
    a generic error without revealing whether similar numbers exist.
    """
    raw = (request.GET.get('phone') or '').strip()
    if not raw:
        return JsonResponse({'available': False, 'error': 'Phone number required.'}, status=400)
    try:
        phone = normalize_e164(raw)
    except Exception:
        return JsonResponse({'available': False, 'error': 'Invalid phone number.'}, status=400)
    exists = User.objects.filter(phone_number=phone).exists()
    return JsonResponse({'available': not exists})


class CustomPasswordResetView(auth_views.PasswordResetView):
    template_name = 'accounts/password_reset.html'
    email_template_name = 'accounts/password_reset_email.html'
    subject_template_name = 'accounts/password_reset_subject.txt'
    success_url = reverse_lazy('accounts:password_reset_done')

    def form_valid(self, form):
        messages.info(
            self.request,
            'If an account exists for that address, a reset link has been sent '
            '(development links appear in the server console).',
        )
        return super().form_valid(form)


class CustomPasswordResetDoneView(auth_views.PasswordResetDoneView):
    template_name = 'accounts/password_reset_done.html'


class CustomPasswordResetConfirmView(auth_views.PasswordResetConfirmView):
    template_name = 'accounts/password_reset_confirm.html'
    success_url = reverse_lazy('accounts:password_reset_complete')

    def form_valid(self, form):
        messages.success(self.request, 'Your password has been changed. Please log in.')
        return super().form_valid(form)


class CustomPasswordResetCompleteView(auth_views.PasswordResetCompleteView):
    template_name = 'accounts/password_reset_complete.html'
