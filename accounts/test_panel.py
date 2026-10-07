"""Tests for the staff-only admin panel: access control and every action."""
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from messaging.models import BlockedUser, Conversation, ConversationParticipant, Notification

from .models import AdminWarning

User = get_user_model()


def make_user(phone, name='', **extra):
    return User.objects.create_user(
        phone_number=phone, password='Passw0rd-Long!', first_name=name, **extra,
    )


class PanelTestBase(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.superuser = User.objects.create_superuser(
            phone_number='+14155559001', password='Passw0rd-Long!', first_name='Root',
        )
        cls.staff = make_user('+14155559002', 'Mod', is_staff=True)
        cls.plain = make_user('+14155559003', 'Plain')
        cls.other = make_user('+14155559004', 'Other')

    def login(self, user):
        self.client.force_login(user)


class PanelAccessTests(PanelTestBase):
    def test_anonymous_redirected_to_login(self):
        response = self.client.get(reverse('accounts:panel_users'))
        self.assertEqual(response.status_code, 302)
        self.assertIn('login', response.url)

    def test_non_staff_gets_403(self):
        self.login(self.plain)
        response = self.client.get(reverse('accounts:panel_users'))
        self.assertEqual(response.status_code, 403)

    def test_staff_can_view_list_and_detail(self):
        self.login(self.staff)
        response = self.client.get(reverse('accounts:panel_users'))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, self.other.get_display_name())
        response = self.client.get(
            reverse('accounts:panel_user_detail', args=[self.other.pk]),
        )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, self.other.phone_number)


class PanelUserListTests(PanelTestBase):
    def test_search_matches_name_phone_email(self):
        self.login(self.staff)
        response = self.client.get(reverse('accounts:panel_users'), {'q': 'Plain'})
        self.assertContains(response, self.plain.phone_number)
        response = self.client.get(reverse('accounts:panel_users'), {'q': '+14155559004'})
        self.assertContains(response, self.other.phone_number)
        response = self.client.get(reverse('accounts:panel_users'), {'q': 'zzz-none'})
        self.assertNotContains(response, self.other.phone_number)

    def test_banned_filter_shows_only_banned(self):
        self.other.is_active = False
        self.other.save(update_fields=['is_active'])
        self.login(self.staff)
        response = self.client.get(reverse('accounts:panel_users'), {'filter': 'banned'})
        self.assertContains(response, self.other.phone_number)
        self.assertNotContains(response, self.plain.phone_number)


class PanelEditTests(PanelTestBase):
    def test_staff_can_edit_names_email_phone(self):
        self.login(self.staff)
        response = self.client.post(
            reverse('accounts:panel_user_update', args=[self.other.pk]),
            {
                'first_name': 'Renamed',
                'last_name': 'User',
                'email': 'renamed@example.com',
                'phone_number': '+1 415 555 9004',  # same number, looser format
                'display_name': 'Renamed User',
                'bio': 'hello',
                'new_password': '',
            },
        )
        self.assertEqual(response.status_code, 302)
        self.other.refresh_from_db()
        self.assertEqual(self.other.first_name, 'Renamed')
        self.assertEqual(self.other.email, 'renamed@example.com')
        self.assertEqual(self.other.phone_number, '+14155559004')
        self.assertEqual(self.other.profile.display_name, 'Renamed User')

    def test_duplicate_phone_rejected(self):
        self.login(self.staff)
        response = self.client.post(
            reverse('accounts:panel_user_update', args=[self.other.pk]),
            {
                'first_name': '', 'last_name': '', 'email': '',
                'phone_number': self.plain.phone_number,  # taken
                'display_name': '', 'bio': '', 'new_password': '',
            },
        )
        self.assertEqual(response.status_code, 302)
        self.other.refresh_from_db()
        self.assertEqual(self.other.phone_number, '+14155559004')  # unchanged

    def test_password_reset_with_validation(self):
        self.login(self.staff)
        self.client.post(
            reverse('accounts:panel_user_update', args=[self.other.pk]),
            {
                'first_name': '', 'last_name': '',
                'email': '', 'phone_number': self.other.phone_number,
                'display_name': '', 'bio': '',
                'new_password': 'NewPassw0rd-Strong!',
            },
        )
        self.other.refresh_from_db()
        self.assertTrue(self.other.check_password('NewPassw0rd-Strong!'))

    def test_weak_password_rejected(self):
        self.login(self.staff)
        self.client.post(
            reverse('accounts:panel_user_update', args=[self.other.pk]),
            {
                'first_name': '', 'last_name': '',
                'email': '', 'phone_number': self.other.phone_number,
                'display_name': '', 'bio': '',
                'new_password': '123',
            },
        )
        self.other.refresh_from_db()
        self.assertTrue(self.other.check_password('Passw0rd-Long!'))  # unchanged


class ModerationActionTests(PanelTestBase):
    def test_warn_creates_record_and_notification(self):
        self.login(self.staff)
        response = self.client.post(
            reverse('accounts:panel_user_warn', args=[self.other.pk]),
            {'reason': 'Spamming group members'},
        )
        self.assertEqual(response.status_code, 302)
        warning = AdminWarning.objects.get(recipient=self.other)
        self.assertEqual(warning.issued_by, self.staff)
        self.assertEqual(warning.reason, 'Spamming group members')
        self.assertTrue(
            Notification.objects.filter(recipient=self.other, kind='system').exists(),
        )

    def test_warn_requires_reason(self):
        self.login(self.staff)
        self.client.post(reverse('accounts:panel_user_warn', args=[self.other.pk]), {'reason': ''})
        self.assertEqual(AdminWarning.objects.count(), 0)

    def test_restrict_hides_from_search_and_blocks_new_chats(self):
        from rest_framework.test import APIClient

        self.login(self.staff)
        self.client.post(reverse('accounts:panel_user_restrict', args=[self.other.pk]))
        self.other.refresh_from_db()
        self.assertTrue(self.other.profile.is_restricted)

        api = APIClient()
        api.force_login(self.plain)
        # Phone search normally finds any registered user — restricted hides them.
        response = api.get('/api/users/search/', {'q': self.other.phone_number})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['results'], [])

        response = api.post('/api/conversations/start/', {'user_id': self.other.pk})
        self.assertEqual(response.status_code, 403)

        # Toggle back off restores visibility.
        self.client.post(reverse('accounts:panel_user_restrict', args=[self.other.pk]))
        self.other.refresh_from_db()
        self.assertFalse(self.other.profile.is_restricted)
        response = api.get('/api/users/search/', {'q': self.other.phone_number})
        self.assertEqual(len(response.data['results']), 1)

    def test_ban_toggles_is_active(self):
        self.login(self.staff)
        self.client.post(reverse('accounts:panel_user_ban', args=[self.other.pk]))
        self.other.refresh_from_db()
        self.assertFalse(self.other.is_active)
        self.client.post(reverse('accounts:panel_user_ban', args=[self.other.pk]))
        self.other.refresh_from_db()
        self.assertTrue(self.other.is_active)

    def test_staff_cannot_moderate_superusers(self):
        self.login(self.staff)
        response = self.client.post(reverse('accounts:panel_user_ban', args=[self.superuser.pk]))
        self.assertEqual(response.status_code, 302)
        self.superuser.refresh_from_db()
        self.assertTrue(self.superuser.is_active)

    def test_nobody_bans_or_deletes_themselves(self):
        self.login(self.staff)
        self.client.post(reverse('accounts:panel_user_ban', args=[self.staff.pk]))
        self.staff.refresh_from_db()
        self.assertTrue(self.staff.is_active)

        self.login(self.superuser)
        self.client.post(
            reverse('accounts:panel_user_delete', args=[self.superuser.pk]),
            {'confirm': 'DELETE'},
        )
        self.assertTrue(User.objects.filter(pk=self.superuser.pk).exists())


class PanelDeleteTests(PanelTestBase):
    def test_only_superuser_can_delete(self):
        self.login(self.staff)
        response = self.client.post(
            reverse('accounts:panel_user_delete', args=[self.other.pk]),
            {'confirm': 'DELETE'},
        )
        self.assertEqual(response.status_code, 302)
        self.assertTrue(User.objects.filter(pk=self.other.pk).exists())

    def test_delete_requires_confirmation_word(self):
        self.login(self.superuser)
        self.client.post(
            reverse('accounts:panel_user_delete', args=[self.other.pk]),
            {'confirm': 'yes'},
        )
        self.assertTrue(User.objects.filter(pk=self.other.pk).exists())

        response = self.client.post(
            reverse('accounts:panel_user_delete', args=[self.other.pk]),
            {'confirm': 'DELETE'},
        )
        self.assertEqual(response.status_code, 302)
        self.assertFalse(User.objects.filter(pk=self.other.pk).exists())
        # Cascades wiped their conversations.
        self.assertFalse(ConversationParticipant.objects.filter(user_id=self.other.pk).exists())

    def test_delete_removes_warnings_and_blocks(self):
        BlockedUser.objects.create(blocker=self.plain, blocked=self.other)
        AdminWarning.objects.create(recipient=self.other, issued_by=self.staff, reason='x')
        self.login(self.superuser)
        self.client.post(
            reverse('accounts:panel_user_delete', args=[self.other.pk]),
            {'confirm': 'DELETE'},
        )
        self.assertEqual(AdminWarning.objects.filter(recipient_id=self.other.pk).count(), 0)
        self.assertEqual(BlockedUser.objects.filter(blocked_id=self.other.pk).count(), 0)


class PanelCreateTests(PanelTestBase):
    def test_staff_can_create_user(self):
        self.login(self.staff)
        response = self.client.post(reverse('accounts:panel_user_create'), {
            'phone_number': '+256772123456',
            'password': 'Passw0rd-Long!',
            'email': 'new@example.com',
            'first_name': 'New',
            'last_name': 'Person',
            'display_name': 'New Person',
        })
        self.assertEqual(response.status_code, 302)
        created = User.objects.get(phone_number='+256772123456')
        self.assertEqual(created.profile.display_name, 'New Person')
        self.assertFalse(created.is_staff)  # only superusers may grant staff

    def test_duplicate_phone_rejected(self):
        self.login(self.staff)
        self.client.post(reverse('accounts:panel_user_create'), {
            'phone_number': self.plain.phone_number,
            'password': 'Passw0rd-Long!',
        })
        self.assertEqual(
            User.objects.filter(phone_number=self.plain.phone_number).count(), 1,
        )

    def test_superuser_can_grant_staff(self):
        self.login(self.superuser)
        self.client.post(reverse('accounts:panel_user_create'), {
            'phone_number': '+256772123457',
            'password': 'Passw0rd-Long!',
            'make_staff': 'on',
        })
        created = User.objects.get(phone_number='+256772123457')
        self.assertTrue(created.is_staff)
