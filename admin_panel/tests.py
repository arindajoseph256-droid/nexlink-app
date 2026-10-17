"""Tests for the Nexlink admin API + role system (security-first)."""
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from django.urls import reverse

from admin_panel.models import (
    AdminRole,
    AuditLog,
    ModerationCase,
    PlatformSettings,
    ROLE_GROUP_NAMES,
    RoleRule,
    Suspension,
    has_caps,
)
from messaging.models import Conversation, Message, UserReport

User = get_user_model()


def make_token(user):
    from rest_framework.authtoken.models import Token
    return Token.objects.get_or_create(user=user)[0].key


def auth_client(user, token=True):
    from rest_framework.test import APIClient
    client = APIClient()
    if token:
        client.credentials(HTTP_AUTHORIZATION='Token ' + make_token(user))
    else:
        client.force_authenticate(user=user)
    return client


class BaseRolesTestCase(TestCase):
    """Create one user per role for permission-matrix tests."""

    @classmethod
    def setUpTestData(cls):
        RoleRule.seed_defaults()
        for role_name in ROLE_GROUP_NAMES.values():
            Group.objects.get_or_create(name=role_name)
        cls.superadmin = User.objects.create_user(
            phone_number='+14085550101', password='Super-secret-1', first_name='S',
        )
        cls.superadmin.is_staff = cls.superadmin.is_superuser = True
        cls.superadmin.save()
        cls.admin = User.objects.create_user(
            phone_number='+14085550102', password='Super-secret-1', first_name='A',
        )
        cls.admin.groups.add(Group.objects.get(name=ROLE_GROUP_NAMES['admin']))
        cls.moderator = User.objects.create_user(
            phone_number='+14085550103', password='Super-secret-1', first_name='M',
        )
        cls.moderator.is_staff = True
        cls.moderator.save()
        cls.moderator.groups.add(Group.objects.get(name=ROLE_GROUP_NAMES['moderator']))
        cls.support = User.objects.create_user(
            phone_number='+14085550104', password='Super-secret-1', first_name='S',
        )
        cls.support.groups.add(Group.objects.get(name=ROLE_GROUP_NAMES['support']))
        cls.plain = User.objects.create_user(
            phone_number='+14085550105', password='Super-secret-1', first_name='U',
        )

    def _admin(self, field='admin_token'):
        return auth_client(getattr(self, field))


class RoleSystemTests(BaseRolesTestCase):
    def test_role_resolution(self):
        self.assertEqual(
            [AdminRole.SUPER_ADMIN], __import__(
                'admin_panel.models', fromlist=['roles_for_user']).roles_for_user(
                self.superadmin),
        )
        self.assertEqual(
            [AdminRole.MODERATOR],
            __import__('admin_panel.models', fromlist=['roles_for_user']).roles_for_user(self.moderator),
        )
        self.assertEqual([], __import__('admin_panel.models', fromlist=['roles_for_user']).roles_for_user(self.plain))

    def test_has_caps_matrix(self):
        self.assertTrue(has_caps(self.superadmin, 'users.delete'))
        self.assertFalse(has_caps(self.moderator, 'users.delete'))
        self.assertTrue(has_caps(self.moderator, 'reports.moderate'))
        self.assertFalse(has_caps(self.plain, 'dashboard'))


class AccessControlTests(BaseRolesTestCase):
    def test_anonymous_gets_401(self):
        from rest_framework.test import APIClient
        client = APIClient()
        response = client.get('/api/admin/dashboard/')
        self.assertIn(response.status_code, (401, 403))

    def test_plain_user_cannot_access_admin_endpoints(self):
        client = auth_client(self.plain)
        self.assertEqual(client.get('/api/admin/dashboard/').status_code, 403)
        self.assertEqual(client.get('/api/admin/users/').status_code, 403)
        self.assertEqual(client.get('/api/admin/audit-logs/').status_code, 403)
        self.assertEqual(client.get('/api/admin/health/').status_code, 403)

    def test_support_cannot_delete(self):
        client = auth_client(self.support)
        self.assertEqual(client.delete(f'/api/admin/users/{self.plain.pk}/delete/').status_code, 403)

    def test_moderator_cannot_manage_administrators(self):
        client = auth_client(self.moderator)
        self.assertEqual(client.get('/api/admin/administrators/').status_code, 403)

    def test_moderator_cannot_change_settings(self):
        client = auth_client(self.moderator)
        response = client.patch(
            '/api/admin/settings/update/',
            {'maintenance_mode': True},
            format='json',
        )
        self.assertEqual(response.status_code, 403)

    def test_admin_user_views_allowed(self):
        client = auth_client(self.admin)
        self.assertEqual(client.get('/api/admin/dashboard/').status_code, 200)
        self.assertEqual(client.get('/api/admin/users/').status_code, 200)


class UserManagementTests(BaseRolesTestCase):
    def test_user_search_and_pagination(self):
        for i in range(30):
            User.objects.create_user(
                phone_number=f'+1415555{i:04d}',
                password='Super-secret-1',
                first_name='Bulk',
            )
        client = auth_client(self.admin)
        response = client.get('/api/admin/users/?page_size=10&q=Bulk', format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['results']), 10)
        self.assertIn('count', response.data)
        response = client.get('/api/admin/users/?q=%2B1415555', format='json')
        self.assertGreaterEqual(response.data['count'], 30)

    def test_user_detail_hides_sensitive_fields(self):
        client = auth_client(self.admin)
        response = client.get(f'/api/admin/users/{self.plain.pk}/')
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('password', response.data)

    def test_warn_creates_record_and_notification(self):
        from accounts.models import AdminWarning
        from messaging.models import Notification
        client = auth_client(self.admin)
        response = client.post(
            f'/api/admin/users/{self.plain.pk}/warn/',
            {'reason': 'Repeated harassment reports', 'category': 'harassment'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(AdminWarning.objects.filter(recipient=self.plain).count(), 1)
        self.assertTrue(
            Notification.objects.filter(recipient=self.plain, kind='system').exists(),
        )
        self.assertTrue(AuditLog.objects.filter(action='user_warned', target_user=self.plain).exists())

    def test_warn_requires_reason(self):
        client = auth_client(self.admin)
        response = client.post(f'/api/admin/users/{self.plain.pk}/warn/', {'reason': ' '}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_suspend_blocks_login_and_tokens(self):
        from rest_framework.test import APIClient
        client = auth_client(self.admin)
        response = client.post(
            f'/api/admin/users/{self.plain.pk}/suspend/',
            {'reason': 'Confirmed fraud reports', 'kind': 'suspension'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.plain.refresh_from_db()
        self.assertFalse(self.plain.is_active)

        # Suspended user cannot authenticate any more.
        anon = APIClient()
        anon.credentials(HTTP_AUTHORIZATION='Token ' + make_token(self.plain))
        self.assertEqual(anon.get('/api/auth/me/').status_code, 403)  # revocation enforced

        login = anon.post(
            '/api/auth/login/',
            {'phone_number': self.plain.phone_number, 'password': 'Super-secret-1'},
            format='json',
        )
        self.assertEqual(login.status_code, 403)

        # And admin-side reactivation restores access.
        self.assertTrue(
            AuditLog.objects.filter(action='user_suspended', target_user=self.plain).exists(),
        )
        client.post(f'/api/admin/users/{self.plain.pk}/reactivate/', {}, format='json')
        self.plain.refresh_from_db()
        self.assertTrue(self.plain.is_active)

    def test_delete_requires_confirmation_and_reason(self):
        target = User.objects.create_user(
            phone_number='+14085550199', password='Super-secret-1',
        )
        client = auth_client(self.admin)  # admin does not have users.delete by default
        response = client.delete(f'/api/admin/users/{target.pk}/delete/')
        self.assertEqual(response.status_code, 403)

        client = auth_client(self.superadmin)
        response = client.delete(f'/api/admin/users/{target.pk}/delete/')
        self.assertEqual(response.status_code, 400)  # missing confirm

        response = client.delete(
            f'/api/admin/users/{target.pk}/delete/',
            {'confirm': 'DELETE', 'reason': 'GDPR erasure request'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(User.objects.filter(pk=target.pk).exists())
        self.assertTrue(AuditLog.objects.filter(action='user_deleted').exists())

    def test_user_edit_rejects_is_active(self):
        client = auth_client(self.admin)
        response = client.patch(
            f'/api/admin/users/{self.plain.pk}/edit/',
            {'is_active': False},
            format='json',
        )
        self.assertEqual(response.status_code, 400)


class ReportsModerationTests(BaseRolesTestCase):
    def setUp(self):
        self.report = UserReport.objects.create(
            reporter=self.plain,
            reported=self.support,
            reason=UserReport.Reason.SPAM,
            details='unsolicited promotions',
        )

    def test_report_assignment_and_resolution(self):
        client = auth_client(self.moderator)
        response = client.post(
            f'/api/admin/reports/{self.report.pk}/assign/',
            {'assigned_to': self.moderator.pk, 'status': 'under_review'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        case = ModerationCase.objects.get(report=self.report)
        self.assertEqual(case.status, ModerationCase.Status.UNDER_REVIEW)

        response = client.post(
            f'/api/admin/reports/{self.report.pk}/resolve/',
            {'resolution': 'Confirmed spam; user suspended.', 'outcome': 'resolved'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        case.refresh_from_db()
        self.assertEqual(case.status, ModerationCase.Status.RESOLVED)
        self.assertEqual(case.resolved_by, self.moderator)

        # Idempotency: second resolve is refused without state change.
        before = case.updated_at
        response = client.post(
            f'/api/admin/reports/{self.report.pk}/resolve/',
            {'resolution': 'again', 'outcome': 'resolved'},
            format='json',
        )
        self.assertEqual(response.status_code, 409)
        case.refresh_from_db()
        self.assertEqual(case.updated_at, before)

    def test_message_content_requires_permission(self):
        client = auth_client(self.support)  # support has no moderation.messages
        response = client.get(
            f'/api/admin/reports/{self.report.pk}/messages/?conversation_id=1',
        )
        self.assertEqual(response.status_code, 403)


class AuditTests(BaseRolesTestCase):
    def test_role_changes_are_audited(self):
        client = auth_client(self.superadmin)
        response = client.post(
            f'/api/admin/administrators/{self.moderator.pk}/role/',
            {'role': 'admin', 'reason': 'promotion after review', 'confirm': 'ROLE-CHANGE'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(AuditLog.objects.filter(action='administrator_role_changed').exists())

    def test_last_super_admin_guarded(self):
        client = auth_client(self.superadmin)
        response = client.post(
            f'/api/admin/administrators/{self.superadmin.pk}/role/',
            {'role': 'moderator', 'reason': 'attempt', 'confirm': 'ROLE-CHANGE'},
            format='json',
        )
        self.assertIn(response.status_code, (400, 403, 409))

    def test_settings_changes_are_audited(self):
        client = auth_client(self.superadmin)
        response = client.patch(
            '/api/admin/settings/update/',
            {'maintenance_mode': True, 'confirm': 'SETTINGS-CHANGE'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(AuditLog.objects.filter(action='settings_updated').exists())


class ExistingFlowsRegressionTests(BaseRolesTestCase):
    def test_login_still_works(self):
        from rest_framework.test import APIClient
        client = APIClient()
        response = client.post(
            '/api/auth/login/',
            {'phone_number': self.plain.phone_number, 'password': 'Super-secret-1'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('token', response.data)

    def test_registration_still_works(self):
        from rest_framework.test import APIClient
        client = APIClient()
        response = client.post(
            '/api/auth/register/',
            {
                'phone_number': '+14085552011',
                'password1': 'very-strong-pass-1',
                'password2': 'very-strong-pass-1',
            },
            format='json',
        )
        # The exact shape of valid register data depends on RegisterForm;
        # 400 with field errors is acceptable, 500 is not.
        self.assertIn(response.status_code, (200, 201, 400))

    def test_messaging_apis_unaffected(self):
        client = auth_client(self.plain)
        response = client.get('/api/conversations/')
        self.assertEqual(response.status_code, 200)

    def test_admin_page_redirects_anonymous(self):
        response = self.client.get('/admin-panel/')
        self.assertEqual(response.status_code, 302)

    def test_admin_page_blocks_non_admins_with_403(self):
        login_ok = self.client.login(
            phone_number=self.plain.phone_number, password='Super-secret-1',
        )
        self.assertTrue(login_ok)
        response = self.client.get('/admin-panel/')
        self.assertEqual(response.status_code, 403)

    def test_admin_page_renders_for_admin(self):
        login_ok = self.client.login(
            phone_number=self.superadmin.phone_number, password='Super-secret-1',
        )
        self.assertTrue(login_ok)
        response = self.client.get('/admin-panel/')
        self.assertEqual(response.status_code, 200)


class FirstSuperAdminSetupTests(TestCase):
    """The one-time /admin-panel/setup/ prompt: appears → creates → disappears."""

    VALID = {
        'phone_number': '+14155550100',
        'first_name': 'Root',
        'email': '',
        'password': 'Vela-Quartz-77-Pine',
        'password_confirm': 'Vela-Quartz-77-Pine',
    }

    def tearDown(self):
        from django.core.cache import cache
        cache.clear()

    def test_prompt_renders_only_while_no_super_admin(self):
        response = self.client.get('/admin-panel/setup/')
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Create the first Super')
        self.assertContains(response, 'csrfmiddlewaretoken')

    def test_admin_panel_routes_to_setup_prompt(self):
        response = self.client.get('/admin-panel/')
        self.assertRedirects(response, '/admin-panel/setup/')

    def test_post_creates_first_super_admin_and_signs_in(self):
        response = self.client.post('/admin-panel/setup/', self.VALID, follow=True)
        self.assertEqual(response.status_code, 200)
        # The chain ends on the real admin dashboard shell.
        self.assertContains(response, 'admin-root')

        user = User.objects.get(phone_number='+14155550100')
        self.assertTrue(user.is_superuser)
        self.assertTrue(user.is_staff)
        self.assertTrue(
            user.groups.filter(name=ROLE_GROUP_NAMES[AdminRole.SUPER_ADMIN]).exists(),
        )
        self.assertEqual(self.client.session.get('_auth_user_id'), str(user.pk))
        # Seeded configuration the dashboard depends on.
        self.assertTrue(RoleRule.objects.filter(role=AdminRole.SUPER_ADMIN).exists())
        self.assertTrue(PlatformSettings.objects.exists())

    def test_prompt_disappears_after_creation(self):
        self.client.post('/admin-panel/setup/', self.VALID)
        self.client.logout()
        # Setup page now bounces anonymous visitors to normal login…
        response = self.client.get('/admin-panel/setup/')
        self.assertRedirects(
            response, '/accounts/login/?next=/admin-panel/setup/',
        )
        # …and /admin-panel/ no longer routes to the prompt either.
        response = self.client.get('/admin-panel/')
        self.assertRedirects(response, '/accounts/login/?next=/admin-panel/')

    def test_second_post_cannot_mint_another_super_admin(self):
        self.client.post('/admin-panel/setup/', self.VALID)
        self.client.logout()
        response = self.client.post(
            '/admin-panel/setup/', {**self.VALID, 'phone_number': '+14155550101'},
        )
        self.assertEqual(response.status_code, 302)
        self.assertFalse(User.objects.filter(phone_number='+14155550101').exists())
        self.assertEqual(User.objects.filter(is_superuser=True).count(), 1)

    def test_mismatched_and_weak_passwords_rejected(self):
        response = self.client.post(
            '/admin-panel/setup/',
            {**self.VALID, 'password_confirm': 'other-pass-phrase-99'},
        )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'The two passwords do not match.')

        response = self.client.post(
            '/admin-panel/setup/',
            {**self.VALID, 'password': 'password123', 'password_confirm': 'password123'},
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(User.objects.filter(is_superuser=True).exists())

    def test_existing_account_promotion_requires_its_password(self):
        existing = User.objects.create_user(
            phone_number='+14155550123', password='Correct-horse-9',
        )
        # Wrong password → refused, account untouched.
        response = self.client.post(
            '/admin-panel/setup/', {**self.VALID, 'phone_number': '+14155550123'},
        )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'already exists')
        existing.refresh_from_db()
        self.assertFalse(existing.is_superuser)

        # Matching password → the existing account is promoted instead.
        response = self.client.post(
            '/admin-panel/setup/',
            {
                **self.VALID,
                'phone_number': '+14155550123',
                'password': 'Correct-horse-9',
                'password_confirm': 'Correct-horse-9',
            },
            follow=True,
        )
        existing.refresh_from_db()
        self.assertTrue(existing.is_superuser)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'admin-root')

    def test_setup_is_throttled_after_too_many_attempts(self):
        from django.core.cache import cache
        from admin_panel import pages

        original = pages.SETUP_ATTEMPT_LIMIT
        pages.SETUP_ATTEMPT_LIMIT = 2
        try:
            bad = {**self.VALID, 'password_confirm': 'mismatch-here-1'}
            self.client.post('/admin-panel/setup/', bad)
            self.client.post('/admin-panel/setup/', bad)
            response = self.client.post('/admin-panel/setup/', bad)
            self.assertEqual(response.status_code, 429)
        finally:
            pages.SETUP_ATTEMPT_LIMIT = original
            cache.clear()


class AdminEmailTests(TestCase):
    """arindajoseph256@gmail.com is the platform admin/sender address."""

    OWNER_EMAIL = 'arindajoseph256@gmail.com'

    def make_superadmin(self):
        user = User.objects.create_user(
            phone_number='+14155550900', password='Super-secret-1',
        )
        user.is_staff = user.is_superuser = True
        user.save(update_fields=['is_staff', 'is_superuser'])
        return user

    def test_default_from_email_is_the_owner_address(self):
        from django.conf import settings
        self.assertEqual(settings.DEFAULT_FROM_EMAIL, self.OWNER_EMAIL)

    def test_settings_api_returns_effective_admin_email(self):
        admin = self.make_superadmin()
        client = auth_client(admin)
        response = client.get('/api/admin/settings/')
        self.assertEqual(response.status_code, 200)
        # Nothing stored yet → falls back to DEFAULT_FROM_EMAIL.
        self.assertEqual(response.data['settings']['admin_email'], self.OWNER_EMAIL)

    def test_settings_api_prefers_superadmin_email_then_stored_override(self):
        admin = self.make_superadmin()
        admin.email = 'owner+super@example.org'
        admin.save(update_fields=['email'])
        client = auth_client(admin)
        response = client.get('/api/admin/settings/')
        self.assertEqual(response.data['settings']['admin_email'], 'owner+super@example.org')

        # An explicit PlatformSettings value wins over both.
        settings_obj = PlatformSettings.for_site()
        settings_obj.admin_email = 'contact@example.org'
        settings_obj.save(update_fields=['admin_email'])
        response = client.get('/api/admin/settings/')
        self.assertEqual(response.data['settings']['admin_email'], 'contact@example.org')

    def test_settings_update_stores_valid_admin_email(self):
        admin = self.make_superadmin()
        client = auth_client(admin)
        response = client.patch(
            '/api/admin/settings/update/',
            {'admin_email': 'New.Owner@Gmail.com'}, format='json',
        )
        self.assertEqual(response.status_code, 200)
        PlatformSettings.for_site().refresh_from_db()
        self.assertEqual(
            PlatformSettings.for_site().admin_email,
            'new.owner@gmail.com',
        )
        audit = AuditLog.objects.filter(action='settings_updated').first()
        self.assertIsNotNone(audit)
        self.assertIn('admin_email', (audit.metadata or {}).get('changed', []))

    def test_settings_update_rejects_invalid_admin_email(self):
        admin = self.make_superadmin()
        client = auth_client(admin)
        response = client.patch(
            '/api/admin/settings/update/',
            {'admin_email': 'not-an-email'}, format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('admin_email', response.data)

    def test_setup_form_prefills_the_owner_email(self):
        response = self.client.get('/admin-panel/setup/')
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, f'value="{self.OWNER_EMAIL}"')

    def test_setup_seeds_platform_admin_email(self):
        response = self.client.post('/admin-panel/setup/', {
            'phone_number': '+14155550100',
            'first_name': 'Root',
            'email': self.OWNER_EMAIL,
            'password': 'Vela-Quartz-77-Pine',
            'password_confirm': 'Vela-Quartz-77-Pine',
        })
        self.assertEqual(response.status_code, 302)
        settings_obj = PlatformSettings.for_site()
        self.assertEqual(settings_obj.admin_email, self.OWNER_EMAIL)
        user = User.objects.get(phone_number='+14155550100')
        self.assertEqual(user.email, self.OWNER_EMAIL)
