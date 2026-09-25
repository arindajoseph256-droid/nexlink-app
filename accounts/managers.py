"""Custom user manager: phone number is the identity, username auto-derived."""
from django.contrib.auth.base_user import BaseUserManager

from .phones import derive_username_from_phone


class UserManager(BaseUserManager):
    """Manager where ``phone_number`` is the login identity.

    ``username`` is derived from the phone number so callers never need to
    supply it. Email is optional (stored blank when omitted).
    """

    use_in_migrations = True

    def _create_user(self, phone_number, password, **extra_fields):
        if not phone_number:
            raise ValueError('A phone number is required.')

        from .phones import normalize_e164
        phone_number = normalize_e164(phone_number)

        username = extra_fields.pop('username', None) or derive_username_from_phone(phone_number)
        email = extra_fields.pop('email', None) or None

        user = self.model(
            phone_number=phone_number,
            username=username,
            email=email,
            **extra_fields,
        )
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, phone_number, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', False)
        extra_fields.setdefault('is_superuser', False)
        return self._create_user(phone_number, password, **extra_fields)

    def create_superuser(self, phone_number, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        if extra_fields.get('is_staff') is not True:
            raise ValueError('Superuser must have is_staff=True.')
        if extra_fields.get('is_superuser') is not True:
            raise ValueError('Superuser must have is_superuser=True.')
        return self._create_user(phone_number, password, **extra_fields)
