"""Authentication and account forms: phone registration, login, profile.

Phone numbers are normalized to E.164 on validation, so the form both
validates and canonicalizes. Login accepts the phone number in any common
format (+14155551234, 415-555-1234, …) because ``clean_username`` maps it
to the canonical stored value before credential checking.
"""
from django import forms
from django.contrib.auth import get_user_model
from django.contrib.auth.forms import UserCreationForm
from django.utils.translation import gettext_lazy as _

from .models import Profile
from .phones import derive_username_from_phone, normalize_e164

User = get_user_model()


class RegisterForm(UserCreationForm):
    """Registration with full name, phone number and password confirmation."""

    full_name = forms.CharField(
        label=_('Full name'),
        max_length=120,
        widget=forms.TextInput(attrs={
            'autocomplete': 'name',
            'placeholder': _('e.g. Alice Nakato'),
            'autofocus': True,
        }),
    )
    phone_number = forms.CharField(
        label=_('Phone number'),
        max_length=32,
        widget=forms.TextInput(attrs={
            'autocomplete': 'tel',
            'inputmode': 'tel',
            'placeholder': _('+1 555 010 1234'),
        }),
        help_text=_('Include your country code, e.g. +1 or +256.'),
    )
    email = forms.EmailField(required=True, widget=forms.EmailInput(attrs={
        'autocomplete': 'email',
        'placeholder': _('you@example.com'),
    }))
    about = forms.CharField(
        required=False,
        max_length=280,
        widget=forms.Textarea(attrs={
            'rows': 2,
            'placeholder': _('A short status (optional)'),
        }),
    )
    picture = forms.ImageField(required=False)

    class Meta(UserCreationForm.Meta):
        model = User
        fields = ('phone_number', 'email')

    def clean_phone_number(self):
        phone = normalize_e164(self.cleaned_data['phone_number'])
        if User.objects.filter(phone_number=phone).exists():
            raise forms.ValidationError(_('An account with this phone number already exists.'))
        return phone

    def clean_email(self):
        email = (self.cleaned_data.get('email') or '').strip().lower()
        if email and User.objects.filter(email__iexact=email).exists():
            raise forms.ValidationError(_('An account with this email already exists.'))
        return email or None

    def clean_full_name(self):
        return ' '.join(self.cleaned_data['full_name'].split())

    def save(self, commit=True):
        user = super().save(commit=False)
        user.first_name = self.cleaned_data['full_name'][:150]
        user.phone_number = self.cleaned_data['phone_number']
        user.email = self.cleaned_data.get('email') or None
        # username is a technical field derived from the phone number.
        user.username = derive_username_from_phone(user.phone_number)
        if commit:
            user.save()
            profile = user.profile
            profile.bio = self.cleaned_data.get('about', '')
            picture = self.cleaned_data.get('picture')
            if picture:
                profile.picture = picture
            profile.save()
        return user


class LoginForm(forms.Form):
    """Validate phone-first credentials, with email as a fallback identifier."""

    username = forms.CharField(
        label=_('Phone number'), required=False,
        widget=forms.TextInput(attrs={
            'autocomplete': 'tel', 'inputmode': 'tel',
            'placeholder': _('+256 700 000 000'),
        }),
    )

    email = forms.EmailField(
        label=_('Email address'),
        widget=forms.EmailInput(attrs={
            'autocomplete': 'email',
            'placeholder': _('you@example.com'),
        }),
    )
    password = forms.CharField(
        label=_('Password'),
        strip=False,
        widget=forms.PasswordInput(attrs={
            'autocomplete': 'current-password',
            'placeholder': _('••••••••'),
        }),
    )

    remember_me = forms.BooleanField(
        required=False,
        initial=False,
        widget=forms.CheckboxInput(attrs={'class': 'checkbox-input'}),
    )

    def __init__(self, *args, **kwargs):
        kwargs.pop('request', None)
        super().__init__(*args, **kwargs)
        self.user_cache = None
        self.fields['email'].required = False

    def clean(self):
        cleaned = super().clean()
        phone_input = (cleaned.get('username') or '').strip()
        email = (cleaned.get('email') or '').strip().lower()
        identifier_input = phone_input or email
        password = cleaned.get('password')
        if not identifier_input:
            raise forms.ValidationError(_('Enter a phone number or email address.'))
        if '@' in identifier_input:
            user = User.objects.filter(email__iexact=identifier_input, is_active=True).first()
        else:
            try:
                identifier = normalize_e164(identifier_input)
            except forms.ValidationError as exc:
                raise forms.ValidationError(str(exc)) from exc
            user = User.objects.filter(phone_number=identifier, is_active=True).first()
        if not user or not password or not user.check_password(password):
            raise forms.ValidationError(_('Enter a correct phone number/email and password.'))
        cleaned['username'] = user.phone_number
        self.user_cache = user
        return cleaned

    def get_user(self):
        return self.user_cache


class ProfileForm(forms.ModelForm):
    """Profile editing: display name, bio and picture."""

    class Meta:
        model = Profile
        fields = (
            'display_name', 'bio', 'picture', 'photo_visibility',
            'about_visibility', 'last_seen_visibility', 'online_visibility',
        )
        widgets = {
            'display_name': forms.TextInput(attrs={
                'placeholder': _('How should others see you?'),
                'maxlength': 50,
            }),
            'bio': forms.Textarea(attrs={
                'rows': 3,
                'placeholder': _('A short status…'),
                'maxlength': 280,
            }),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field_name in (
            'photo_visibility', 'about_visibility',
            'last_seen_visibility', 'online_visibility',
        ):
            self.fields[field_name].required = False

    def clean(self):
        cleaned = super().clean()
        for field_name in (
            'photo_visibility', 'about_visibility',
            'last_seen_visibility', 'online_visibility',
        ):
            if not cleaned.get(field_name):
                cleaned[field_name] = getattr(self.instance, field_name)
        return cleaned

    def clean_display_name(self):
        return self.cleaned_data['display_name'].strip()


class UserEmailForm(forms.ModelForm):
    """Allow the user to change their (optional) account email."""

    class Meta:
        model = User
        fields = ('email',)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['email'].widget.attrs.update({
            'autocomplete': 'email',
        })

    def clean_email(self):
        email = (self.cleaned_data.get('email') or '').strip().lower()
        qs = User.objects.filter(email__iexact=email)
        if self.instance and self.instance.pk:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise forms.ValidationError(_('An account with this email already exists.'))
        return email


class PhoneChangeForm(forms.Form):
    """Change the phone number associated with the account."""

    new_phone_number = forms.CharField(
        label=_('New phone number'),
        max_length=32,
        widget=forms.TextInput(attrs={
            'autocomplete': 'tel',
            'inputmode': 'tel',
            'placeholder': _('+1 555 010 1234'),
        }),
    )

    def clean_new_phone_number(self):
        phone = normalize_e164(self.cleaned_data['new_phone_number'])
        qs = User.objects.filter(phone_number=phone)
        if self.initial.get('current_phone') == phone:
            raise forms.ValidationError(_('This is already your phone number.'))
        if qs.exists():
            raise forms.ValidationError(_('An account with this phone number already exists.'))
        return phone
