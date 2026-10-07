"""Forms for the staff-only admin panel (/panel/)."""
from django import forms
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError

from .phones import normalize_e164

User = get_user_model()


class PanelUserEditForm(forms.Form):
    """Edit identity + profile fields for one user (staff panel)."""

    first_name = forms.CharField(max_length=30, required=False)
    last_name = forms.CharField(max_length=30, required=False)
    email = forms.EmailField(required=False)
    phone_number = forms.CharField(max_length=32)
    display_name = forms.CharField(max_length=50, required=False)
    bio = forms.CharField(max_length=280, required=False)
    new_password = forms.CharField(
        required=False,
        widget=forms.PasswordInput,
        help_text='Leave blank to keep the current password.',
    )

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = user

    def clean_phone_number(self):
        phone = normalize_e164(self.cleaned_data['phone_number'])
        clash = User.objects.filter(phone_number=phone).exclude(pk=self.user.pk).exists()
        if clash:
            raise ValidationError('An account with this phone number already exists.')
        return phone

    def clean_email(self):
        email = (self.cleaned_data.get('email') or '').strip().lower() or None
        if email:
            clash = User.objects.filter(email__iexact=email).exclude(pk=self.user.pk).exists()
            if clash:
                raise ValidationError('An account with this email already exists.')
        return email

    def clean_new_password(self):
        password = self.cleaned_data.get('new_password') or ''
        if password:
            validate_password(password, user=self.user)
        return password


class PanelUserCreateForm(forms.Form):
    """Create a user from the panel (phone-first identity, like registration)."""

    phone_number = forms.CharField(max_length=32)
    email = forms.EmailField(required=False)
    first_name = forms.CharField(max_length=30, required=False)
    last_name = forms.CharField(max_length=30, required=False)
    display_name = forms.CharField(max_length=50, required=False)
    password = forms.CharField(widget=forms.PasswordInput)
    make_staff = forms.BooleanField(required=False)

    def clean_phone_number(self):
        phone = normalize_e164(self.cleaned_data['phone_number'])
        if User.objects.filter(phone_number=phone).exists():
            raise ValidationError('An account with this phone number already exists.')
        return phone

    def clean_email(self):
        email = (self.cleaned_data.get('email') or '').strip().lower() or None
        if email and User.objects.filter(email__iexact=email).exists():
            raise ValidationError('An account with this email already exists.')
        return email

    def clean_password(self):
        password = self.cleaned_data.get('password') or ''
        validate_password(password)
        return password


class PanelWarnForm(forms.Form):
    reason = forms.CharField(
        max_length=500,
        widget=forms.Textarea(attrs={'rows': 3, 'placeholder': 'Why is this user being warned?'}),
    )

    def clean_reason(self):
        reason = (self.cleaned_data.get('reason') or '').strip()
        if len(reason) < 3:
            raise ValidationError('Give a short reason for the warning.')
        return reason[:500]
