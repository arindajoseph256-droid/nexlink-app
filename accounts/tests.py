"""Tests for the accounts app: registration, login, profile, password reset."""
from django.contrib.auth import get_user_model
from django.core.exceptions import FieldDoesNotExist
from django.test import TestCase, Client, override_settings
from django.urls import reverse
from django.utils import timezone
from datetime import timedelta
from unittest.mock import patch

User = get_user_model()


class RegistrationTests(TestCase):
    def test_register_page_renders(self):
        response = self.client.get(reverse('accounts:register'))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Create your account')

    def test_successful_registration_creates_user_and_profile(self):
        response = self.client.post(reverse('accounts:register'), {
            'full_name': 'Alice Example',
            'phone_number': '+14155550101',
            'email': 'alice@example.com',
            'password1': 'Sup3r-Secret-Pass!',
            'password2': 'Sup3r-Secret-Pass!',
        })
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response['Location'], reverse('messaging:conversations'))
        user = User.objects.get(phone_number='+14155550101')
        self.assertEqual(user.email, 'alice@example.com')
        self.assertTrue(user.check_password('Sup3r-Secret-Pass!'))
        self.assertEqual(user.first_name, 'Alice Example')
        self.assertIsNotNone(user.profile)  # profile auto-created
        self.assertTrue(user.is_authenticated)

    def test_duplicate_email_rejected(self):
        User.objects.create_user(phone_number='+14155550102', email='taken@example.com', password='Xx123456!')
        response = self.client.post(reverse('accounts:register'), {
            'full_name': 'Another User', 'phone_number': '+14155550103',
            'email': 'TAKEN@example.com',
            'password1': 'Sup3r-Secret-Pass!',
            'password2': 'Sup3r-Secret-Pass!',
        })
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'already exists')
        self.assertFalse(User.objects.filter(phone_number='+14155550103').exists())

    def test_invalid_username_rejected(self):
        response = self.client.post(reverse('accounts:register'), {
            'full_name': 'Invalid User', 'phone_number': 'not-a-phone',
            'email': 'x@example.com',
            'password1': 'Sup3r-Secret-Pass!',
            'password2': 'Sup3r-Secret-Pass!',
        })
        self.assertEqual(response.status_code, 200)
        self.assertFalse(User.objects.filter(email='x@example.com').exists())

    def test_password_mismatch_rejected(self):
        response = self.client.post(reverse('accounts:register'), {
            'full_name': 'Carol', 'phone_number': '+14155550104',
            'email': 'carol@example.com',
            'password1': 'Sup3r-Secret-Pass!',
            'password2': 'Different-Pass-123!',
        })
        self.assertEqual(response.status_code, 200)
        self.assertFalse(User.objects.filter(phone_number='+14155550104').exists())

    def test_username_availability_api(self):
        User.objects.create_user(phone_number='+14155550105', email='t@example.com', password='Xx123456!')
        response = self.client.get(reverse('accounts:phone_available'),
                       {'phone': '+14155550105'})
        self.assertJSONEqual(response.content, {'available': False})
        response = self.client.get(reverse('accounts:phone_available'),
                       {'phone': '+14155550106'})
        self.assertJSONEqual(response.content, {'available': True})


class VerificationCleanupTests(TestCase):
    def test_user_model_does_not_store_verification_flags(self):
        with self.assertRaises(FieldDoesNotExist):
            User._meta.get_field('phone_verified')
        with self.assertRaises(FieldDoesNotExist):
            User._meta.get_field('email_verified')


class LoginTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(
            phone_number='+14155550201', email='dave@example.com', password='Passw0rd-Long!',
        )

    def complete_login(self, identifier='+14155550201', remember_me=False):
        response = self.client.post(reverse('accounts:login'), {
            'username': identifier,
            'password': 'Passw0rd-Long!',
            'remember_me': 'on' if remember_me else '',
        })
        self.assertRedirects(response, reverse('messaging:conversations'))
        return response

    def test_login_page_renders(self):
        response = self.client.get(reverse('accounts:login'))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Welcome back')

    def test_login_with_username(self):
        response = self.complete_login()
        self.assertRedirects(response, reverse('messaging:conversations'))

    def test_login_with_email(self):
        response = self.complete_login(identifier='DAVE@example.com')
        self.assertRedirects(response, reverse('messaging:conversations'))

    def test_login_wrong_password(self):
        response = self.client.post(reverse('accounts:login'), {
            'username': '+14155550201',
            'password': 'WrongPassword1!',
        })
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'correct')

    def test_remember_me_extends_session(self):
        response = self.complete_login(remember_me=True)
        self.assertRedirects(response, reverse('messaging:conversations'))
        self.assertGreater(self.client.session.get_expiry_age(), 86000)

    def test_without_remember_me_session_expires_on_close(self):
        self.complete_login()
        # Expiry of 0 means "expire at browser close"; get_expiry_age reports
        # the *default* age in that case, so inspect the flag instead.
        self.assertEqual(self.client.session.get_expire_at_browser_close(), True)

    def test_authenticated_user_redirected_from_login(self):
        self.client.force_login(self.user)
        response = self.client.get(reverse('accounts:login'))
        self.assertRedirects(response, reverse('messaging:conversations'))

    def test_logout(self):
        self.client.force_login(self.user)
        response = self.client.post(reverse('accounts:logout'))
        self.assertRedirects(response, reverse('accounts:login'))
        response = self.client.get(reverse('messaging:conversations'))
        self.assertEqual(response.status_code, 302)  # bounced to login


class ProtectedPagesTests(TestCase):
    def test_conversations_requires_login(self):
        response = self.client.get(reverse('messaging:conversations'))
        self.assertEqual(response.status_code, 302)
        self.assertIn('login', response.url)

    def test_profile_requires_login(self):
        response = self.client.get(reverse('accounts:profile'))
        self.assertEqual(response.status_code, 302)

    def test_profile_renders_when_logged_in(self):
        user = User.objects.create_user(phone_number='+14155550701', password='Passw0rd-Long!')
        self.client.force_login(user)
        response = self.client.get(reverse('accounts:profile'))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, '+1415')


class ProfileSettingsTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            phone_number='+14155550301', email='frank@example.com', password='Passw0rd-Long!',
        )
        self.client.force_login(self.user)

    def test_update_display_name_and_bio(self):
        response = self.client.post(reverse('accounts:settings'), {
            'display_name': 'Frank the Builder',
            'bio': 'Building things all day.',
            'email': 'frank@example.com',
        })
        self.assertRedirects(response, reverse('accounts:profile'))
        self.user.profile.refresh_from_db()
        self.assertEqual(self.user.profile.display_name, 'Frank the Builder')
        self.assertEqual(self.user.profile.bio, 'Building things all day.')

    def test_email_change_with_duplicate_rejected(self):
        User.objects.create_user(phone_number='+14155550302', email='other@example.com',
                                 password='Xx123456!')
        response = self.client.post(reverse('accounts:settings'), {
            'display_name': '',
            'bio': '',
            'email': 'other@example.com',
        })
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'already exists')

    def test_display_name_used_via_api_helper(self):
        # get_display_name prefers profile.display_name over username.
        self.user.profile.display_name = 'Franky'
        self.user.profile.save()
        self.assertEqual(self.user.get_display_name(), 'Franky')


class PasswordChangeTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            phone_number='+14155550401', email='ivy@example.com', password='OldPassw0rd-Long!',
        )
        self.client.force_login(self.user)

    def test_change_password_success(self):
        response = self.client.post(reverse('accounts:password_change'), {
            'old_password': 'OldPassw0rd-Long!',
            'new_password1': 'Fresh-Pass-2026!x',
            'new_password2': 'Fresh-Pass-2026!x',
        })
        self.assertEqual(response.status_code, 302)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('Fresh-Pass-2026!x'))

    def test_change_password_wrong_old_rejected(self):
        response = self.client.post(reverse('accounts:password_change'), {
            'old_password': 'Wrong-Old-Pass!',
            'new_password1': 'Fresh-Pass-2026!x',
            'new_password2': 'Fresh-Pass-2026!x',
        })
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('OldPassw0rd-Long!'))

    def test_change_password_requires_login(self):
        self.client.logout()
        response = self.client.get(reverse('accounts:password_change'))
        self.assertEqual(response.status_code, 302)


class PasswordResetTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(
            phone_number='+14155550501', email='grace@example.com', password='OldPassw0rd!',
        )

    def test_request_reset_page(self):
        response = self.client.get(reverse('accounts:password_reset'))
        self.assertEqual(response.status_code, 200)

    def test_reset_email_sent_and_flow_works(self):
        response = self.client.post(reverse('accounts:password_reset'),
                                    {'email': 'grace@example.com'})
        self.assertEqual(response.status_code, 302)

        from django.core import mail
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('grace@example.com', mail.outbox[0].to)

        # Extract the reset link from the email body.
        import re
        match = re.search(r'/accounts/password-reset/([^/\s]+)/([^/\s]+)/',
                          mail.outbox[0].body)
        self.assertIsNotNone(match, 'Reset link not found in email body')
        uid, token = match.group(1), match.group(2)

        confirm_url = reverse('accounts:password_reset_confirm', kwargs={
            'uidb64': uid, 'token': token,
        })
        # Django 302-redirects the token URL to a one-time /set-password/ URL.
        response = self.client.get(confirm_url)
        self.assertEqual(response.status_code, 302)
        response = self.client.get(confirm_url, follow=True)
        self.assertEqual(response.status_code, 200)

        form_url = response.request['PATH_INFO']
        response = self.client.post(form_url, {
            'new_password1': 'Brand-New-Pass-99!',
            'new_password2': 'Brand-New-Pass-99!',
        })
        self.assertEqual(response.status_code, 302)

        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('Brand-New-Pass-99!'))

    def test_reset_unknown_email_does_not_leak(self):
        response = self.client.post(reverse('accounts:password_reset'),
                                    {'email': 'nobody@example.com'})
        # Same success behavior either way (no user enumeration).
        self.assertEqual(response.status_code, 302)
        from django.core import mail
        self.assertEqual(len(mail.outbox), 0)


class SecurityTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(
            phone_number='+14155550601', email='hank@example.com', password='Passw0rd-Long!',
        )

    def test_csrf_required_on_login(self):
        client = Client(enforce_csrf_checks=True)
        response = client.post(reverse('accounts:login'), {
            'username': '+14155550601', 'password': 'Passw0rd-Long!',
        })
        self.assertEqual(response.status_code, 403)

    def test_password_is_hashed_not_stored(self):
        self.assertNotEqual(self.user.password, 'Passw0rd-Long!')
        self.assertTrue(self.user.password.startswith(('pbkdf2_', 'argon2', 'bcrypt')))


class PushDeviceAPITests(TestCase):
    """Expo push-token registry endpoints."""

    def _login_user(self):
        user = User.objects.create_user(
            phone_number='+14155550700', password='Sup3rSecure!2026',
        )
        from rest_framework.authtoken.models import Token
        token = Token.objects.create(user=user)
        return user, token.key

    def test_register_requires_auth(self):
        response = self.client.post(
            '/api/auth/push/register/', {'token': 'ExponentPushToken[abc]'},
            content_type='application/json',
        )
        self.assertIn(response.status_code, (401, 403))

    def test_register_and_reregister_token(self):
        _, key = self._login_user()
        auth = {'HTTP_AUTHORIZATION': f'Token {key}'}
        response = self.client.post(
            '/api/auth/push/register/',
            {'token': 'ExponentPushToken[abc]', 'platform': 'expo'},
            content_type='application/json', **auth,
        )
        self.assertEqual(response.status_code, 200)
        # same token again → still one row, ownership updated
        response2 = self.client.post(
            '/api/auth/push/register/',
            {'token': 'ExponentPushToken[abc]'},
            content_type='application/json', **auth,
        )
        self.assertEqual(response2.status_code, 200)
        from accounts.push_models import PushDevice
        self.assertEqual(PushDevice.objects.filter(token='ExponentPushToken[abc]').count(), 1)

    def test_register_rejects_empty_token(self):
        _, key = self._login_user()
        response = self.client.post(
            '/api/auth/push/register/', {'token': ''},
            content_type='application/json',
            HTTP_AUTHORIZATION=f'Token {key}',
        )
        self.assertEqual(response.status_code, 400)

    def test_unregister_removes_only_own_token(self):
        user, key = self._login_user()
        other_user = User.objects.create_user(
            phone_number='+14155550701', password='Sup3rSecure!2026',
        )
        from rest_framework.authtoken.models import Token
        other_key = Token.objects.create(user=other_user).key
        from accounts.push_models import PushDevice
        PushDevice.objects.create(user=user, token='ExponentPushToken[own]')
        PushDevice.objects.create(user=other_user, token='ExponentPushToken[other]')

        # cannot remove someone else's token
        self.client.post(
            '/api/auth/push/unregister/', {'token': 'ExponentPushToken[other]'},
            content_type='application/json', HTTP_AUTHORIZATION=f'Token {key}',
        )
        self.assertTrue(PushDevice.objects.filter(token='ExponentPushToken[other]').exists())

        self.client.post(
            '/api/auth/push/unregister/', {'token': 'ExponentPushToken[own]'},
            content_type='application/json', HTTP_AUTHORIZATION=f'Token {key}',
        )
        self.assertFalse(PushDevice.objects.filter(token='ExponentPushToken[own]').exists())

    def test_health_endpoint(self):
        from django.test import override_settings
        response = self.client.get('/health/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'ok')


class AccountChangeApiTests(TestCase):
    """Token-auth password/email change endpoints used by the mobile app."""

    def setUp(self):
        from rest_framework.authtoken.models import Token
        self.user = User.objects.create_user(
            phone_number='+14155550801', email='pat@example.com',
            password='OldPassw0rd-Long!',
        )
        self.token = Token.objects.create(user=self.user).key
        self.auth = f'Token {self.token}'

    def _post(self, url, payload):
        return self.client.post(
            url, payload, content_type='application/json', HTTP_AUTHORIZATION=self.auth,
        )

    def test_password_change_success(self):
        response = self._post('/api/auth/password-change/', {
            'old_password': 'OldPassw0rd-Long!',
            'new_password1': 'Fresh-Pass-2026!x',
            'new_password2': 'Fresh-Pass-2026!x',
        })
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('Fresh-Pass-2026!x'))

    def test_password_change_wrong_old_rejected(self):
        response = self._post('/api/auth/password-change/', {
            'old_password': 'Wrong-Old-Pass!',
            'new_password1': 'Fresh-Pass-2026!x',
            'new_password2': 'Fresh-Pass-2026!x',
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn('detail', response.json())
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('OldPassw0rd-Long!'))

    def test_password_change_requires_auth(self):
        response = self.client.post(
            '/api/auth/password-change/',
            {'old_password': 'x', 'new_password1': 'x', 'new_password2': 'x'},
            content_type='application/json',
        )
        self.assertIn(response.status_code, (401, 403))

    def test_email_change_success(self):
        response = self._post('/api/auth/email-change/', {'email': 'new-pat@example.com'})
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, 'new-pat@example.com')

    def test_email_change_duplicate_rejected(self):
        User.objects.create_user(
            phone_number='+14155550802', email='taken@example.com', password='Xx123456!',
        )
        response = self._post('/api/auth/email-change/', {'email': 'TAKEN@example.com'})
        self.assertEqual(response.status_code, 400)
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, 'pat@example.com')

    def test_email_change_requires_auth(self):
        response = self.client.post(
            '/api/auth/email-change/', {'email': 'anon@example.com'},
            content_type='application/json',
        )
        self.assertIn(response.status_code, (401, 403))


class AccountBackupApiTests(TestCase):
    """Account backup download + email-to-recovery-address endpoints."""

    def setUp(self):
        from rest_framework.authtoken.models import Token
        self.user = User.objects.create_user(
            phone_number='+14155550811', email='backup@example.com',
            password='Sup3r-Secret-Pass!',
        )
        self.auth = f'Token {Token.objects.create(user=self.user).key}'

    def _get(self, url):
        return self.client.get(url, HTTP_AUTHORIZATION=self.auth)

    def _post(self, url):
        return self.client.post(
            url, {}, content_type='application/json', HTTP_AUTHORIZATION=self.auth,
        )

    def test_backup_requires_auth(self):
        response = self.client.get('/api/auth/backup/')
        self.assertIn(response.status_code, (401, 403))

    def test_backup_contains_account_profile_and_messages(self):
        from messaging.models import Conversation
        peer = User.objects.create_user(
            phone_number='+14155550812', password='Xx123456!',
        )
        conversation, _ = Conversation.get_or_create_between(self.user, peer)
        conversation.messages.create(sender=self.user, body='hello backup')

        response = self._get('/api/auth/backup/')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['schema'], 'nexlink.backup.v1')
        self.assertEqual(data['account']['email'], 'backup@example.com')
        self.assertEqual(data['counts']['conversations'], 1)
        bodies = [
            message['body']
            for item in data['conversations']
            for message in item['messages']
        ]
        self.assertIn('hello backup', bodies)
        self.assertIn('preferences', data)
        self.assertIn('contacts', data)

    def test_backup_email_sent_to_recovery_email(self):
        from django.core import mail
        response = self._post('/api/auth/backup/email/')
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload['email'], 'backup@example.com')
        self.assertTrue(payload['sent'])
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ['backup@example.com'])
        filename, content, mimetype = mail.outbox[0].attachments[0]
        self.assertTrue(filename.endswith('.json'))
        self.assertEqual(mimetype, 'application/json')
        raw = content.encode() if isinstance(content, str) else content
        self.assertIn(b'"nexlink.backup.v1"', raw)

    def test_backup_email_requires_recovery_email(self):
        self.user.email = ''
        self.user.save(update_fields=['email'])
        response = self._post('/api/auth/backup/email/')
        self.assertEqual(response.status_code, 400)
        self.assertIn('detail', response.json())


class PushConfigAPITests(TestCase):
    """Public VAPID configuration endpoint for Web Push."""

    def test_config_is_public_and_stable(self):
        response = self.client.get('/api/auth/push/config/')
        self.assertEqual(response.status_code, 200)
        key = response.json()['public_key']
        self.assertGreaterEqual(len(key), 80)
        # Second call returns the SAME key (stored key pair, not regenerated).
        again = self.client.get('/api/auth/push/config/').json()['public_key']
        self.assertEqual(key, again)
        from accounts.push_models import VapidKey
        self.assertEqual(VapidKey.objects.count(), 1)


class WebPushSubscriptionAPITests(TestCase):
    """Browser Web Push subscription registry endpoints."""

    def setUp(self):
        self.user = User.objects.create_user(
            phone_number='+14155550900', password='Sup3rSecure!2026',
        )
        from rest_framework.authtoken.models import Token
        self.token = Token.objects.create(user=self.user)
        self.auth = {'HTTP_AUTHORIZATION': f'Token {self.token.key}'}
        self.subscription = {
            'endpoint': 'https://fcm.googleapis.com/fcm/send/test-endpoint-1',
            'keys': {'p256dh': 'B' * 87, 'auth': 'A' * 24},
        }

    def test_subscribe_requires_auth(self):
        response = self.client.post(
            '/api/auth/push/subscribe/', {'subscription': self.subscription},
            content_type='application/json',
        )
        self.assertIn(response.status_code, (401, 403))

    def test_subscribe_creates_subscription(self):
        response = self.client.post(
            '/api/auth/push/subscribe/', {'subscription': self.subscription},
            content_type='application/json', **self.auth,
        )
        self.assertEqual(response.status_code, 200)
        from accounts.push_models import WebPushSubscription
        sub = WebPushSubscription.objects.get(endpoint=self.subscription['endpoint'])
        self.assertEqual(sub.user, self.user)
        self.assertEqual(sub.p256dh, 'B' * 87)

    def test_subscribe_accepts_flat_payload(self):
        flat = dict(self.subscription)
        response = self.client.post(
            '/api/auth/push/subscribe/', flat,
            content_type='application/json', **self.auth,
        )
        self.assertEqual(response.status_code, 200)

    def test_re_subscribe_updates_not_duplicates(self):
        self.client.post(
            '/api/auth/push/subscribe/', {'subscription': self.subscription},
            content_type='application/json', **self.auth,
        )
        changed = {
            'endpoint': self.subscription['endpoint'],
            'keys': {'p256dh': 'C' * 87, 'auth': 'B' * 24},
        }
        self.client.post(
            '/api/auth/push/subscribe/', {'subscription': changed},
            content_type='application/json', **self.auth,
        )
        from accounts.push_models import WebPushSubscription
        self.assertEqual(WebPushSubscription.objects.count(), 1)
        self.assertEqual(
            WebPushSubscription.objects.get().p256dh, 'C' * 87,
        )

    def test_subscribe_rejects_missing_keys(self):
        bad = {'endpoint': self.subscription['endpoint'], 'keys': {}}
        response = self.client.post(
            '/api/auth/push/subscribe/', {'subscription': bad},
            content_type='application/json', **self.auth,
        )
        self.assertEqual(response.status_code, 400)

    def test_subscribe_rejects_non_https_endpoint(self):
        bad = {'endpoint': 'http://insecure.example/push', 'keys': self.subscription['keys']}
        response = self.client.post(
            '/api/auth/push/subscribe/', {'subscription': bad},
            content_type='application/json', **self.auth,
        )
        self.assertEqual(response.status_code, 400)

    def test_unsubscribe_removes_only_own_subscription(self):
        other = User.objects.create_user(
            phone_number='+14155550901', password='Sup3rSecure!2026',
        )
        from accounts.push_models import WebPushSubscription
        WebPushSubscription.objects.create(
            user=other, endpoint=self.subscription['endpoint'],
            p256dh='B' * 87, auth='A' * 24,
        )
        response = self.client.post(
            '/api/auth/push/unsubscribe/', {'endpoint': self.subscription['endpoint']},
            content_type='application/json', **self.auth,
        )
        self.assertEqual(response.status_code, 200)
        # Other user's subscription is untouched (scoped to request.user).
        self.assertTrue(WebPushSubscription.objects.filter(endpoint=self.subscription['endpoint']).exists())
