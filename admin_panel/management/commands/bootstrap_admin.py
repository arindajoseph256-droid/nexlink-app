"""Secure bootstrap for the first Super Admin (server-side only).

Usage (on the server, never exposed via HTTP):

    python manage.py bootstrap_admin --phone +14155550100 --password '…'

Checks:
- Runs inside a single transaction; aborts if a Super Admin already exists
  unless --force is given explicitly.
- Seed data (RoleRules, groups, settings) is idempotent and safe to re-run.
"""
from getpass import getpass

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth.password_validation import validate_password
from django.db import transaction

from admin_panel.models import (
    PlatformSettings,
    ROLE_GROUP_NAMES,
    RoleRule,
)

User = get_user_model()


class Command(BaseCommand):
    help = 'Create the first Super Admin and seed default admin configuration.'

    def add_arguments(self, parser):
        parser.add_argument('--phone', required=True, help='E.164 phone of the Super Admin.')
        parser.add_argument('--email', default='', help='Optional email.')
        parser.add_argument('--first-name', default='', help='Optional first name.')
        parser.add_argument('--password', help='Password (defaults to interactive prompt).')
        parser.add_argument(
            '--force', action='store_true',
            help='Allow granting a second Super Admin (already exists).',
        )

    def handle(self, *args, **options):
        phone = options['phone'].strip()
        password = options['password'] or getpass('Super Admin password: ')

        existing_superadmins = User.objects.filter(is_superuser=True).count()
        if existing_superadmins and not options['force']:
            raise CommandError(
                f'{existing_superadmins} Super Admin(s) already exist. '
                'Use the admin panel ( Administrators) to add more, or pass --force explicitly.',
            )

        from admin_panel.models import roles_for_user, role_for_user, has_caps

        with transaction.atomic():
            # 1. Groups (idempotent)
            groups = {}
            for role_name in ROLE_GROUP_NAMES.values():
                groups[role_name], _ = Group.objects.get_or_create(name=role_name)

            # 2. Default per-role capability grants (idempotent)
            RoleRule.seed_defaults()

            # 3. Single-row platform settings
            PlatformSettings.for_site()

            # 4. Super Admin user
            user = User.objects.filter(phone_number=phone).first()
            if user is None:
                try:
                    validate_password(password)
                except ValidationError as exc:
                    raise CommandError(f'Weak password: {"; ".join(exc.messages)}')
                user = User.objects.create_user(
                    phone_number=phone,
                    password=password,
                    email=options['email'].strip().lower() or None,
                    first_name=options['first_name'].strip()[:30],
                )
                created = True
            else:
                if not user.check_password(password):
                    raise CommandError('User exists but password does not match.')
                created = False

            user.is_staff = True
            user.is_superuser = True
            user.is_active = True
            user.save(update_fields=['is_staff', 'is_superuser', 'is_active'])

            super_admin_group = groups[ROLE_GROUP_NAMES['super_admin']]
            user.groups.add(super_admin_group)

        self.stdout.write(self.style.SUCCESS(
            f'{"Created" if created else "Promoted"} Super Admin {phone} '
            f'(user id {user.pk}).',
        ))
        self.stdout.write('— Role groups present, default RoleRules seeded, platform settings ready.')
        self.stdout.write('— Point staff at /admin-panel/ (web) and use the DRF API under /api/admin/.')
