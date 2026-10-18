"""Tests for the Google Contacts discovery endpoints.

The Google People API is mocked, so no network is touched. These tests pin
down the contract: config is public but secret-free, the token is required,
People API errors map to friendly statuses, and matches come back with safe
fields only under the ``google_contacts`` source.
"""
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

User = get_user_model()


def make_user(phone, email=None, name=''):
    return User.objects.create_user(
        phone_number=phone,
        email=email,
        password='Passw0rd-Long!',
        first_name=name,
    )


class GoogleConfigTests(TestCase):
    def test_disabled_by_default_no_secrets(self):
        response = APIClient().get('/api/contacts/google/config/')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data['enabled'])
        self.assertEqual(response.data['client_id'], '')
        self.assertEqual(
            response.data['scope'],
            'https://www.googleapis.com/auth/contacts.readonly',
        )

    def test_enabled_when_client_id_set(self):
        with self.settings(GOOGLE_CONTACTS_CLIENT_ID='web-client-id.apps.googleusercontent.com'):
            response = APIClient().get('/api/contacts/google/config/')
        self.assertTrue(response.data['enabled'])
        self.assertEqual(response.data['client_id'], 'web-client-id.apps.googleusercontent.com')


class GoogleMatchTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alice = make_user('+14155554001', 'g-alice@example.com', 'Alice')
        cls.bob = make_user('+14155554002', 'bob@example.com', 'Bob')

    def setUp(self):
        from django.core.cache import cache
        cache.clear()  # throttle state is process-global; isolate each test
        self.client = APIClient()
        self.client.force_login(self.alice)

    def _mock_connection(self):
        return {
            'connections': [
                {
                    'phoneNumbers': [{'value': '+14155554002'}],
                    'emailAddresses': [{'value': 'Bob@Example.com'}],
                },
            ],
        }

    def test_match_returns_safe_google_results(self):
        with patch('messaging.google_contacts.fetch_google_contacts') as fetch:
            fetch.return_value = ({'+14155554002'}, {'Bob@Example.com'}, 1)
            response = self.client.post(
                '/api/contacts/google/',
                {'access_token': 'ya29.' + 'a' * 30},
                format='json',
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['results']), 1)
        row = response.data['results'][0]
        self.assertEqual(row['id'], self.bob.pk)
        self.assertEqual(row['source'], 'google_contacts')
        self.assertNotIn('phone', row)
        self.assertNotIn('email', row)

    def test_unauthenticated_rejected(self):
        response = APIClient().post(
            '/api/contacts/google/',
            {'access_token': 'ya29.' + 'a' * 30},
            format='json',
        )
        self.assertIn(response.status_code, (401, 403))

    def test_missing_token_rejected(self):
        response = self.client.post('/api/contacts/google/', {}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_short_token_rejected(self):
        response = self.client.post('/api/contacts/google/', {'access_token': 'too-short'}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_expired_token_maps_to_401_with_friendly_message(self):
        from messaging.google_contacts import GoogleContactsError
        with patch('messaging.google_contacts.fetch_google_contacts') as fetch:
            fetch.side_effect = GoogleContactsError(
                'Google authorization expired or was revoked. Connect Google Contacts again.',
                status=401,
            )
            response = self.client.post(
                '/api/contacts/google/',
                {'access_token': 'ya29.' + 'a' * 30},
                format='json',
            )
        self.assertEqual(response.status_code, 401)
        self.assertIn('expired', response.data['detail'])

    def test_google_outage_maps_to_502(self):
        from messaging.google_contacts import GoogleContactsError
        with patch('messaging.google_contacts.fetch_google_contacts') as fetch:
            fetch.side_effect = GoogleContactsError(
                'Could not reach Google Contacts. Try again.', status=502,
            )
            response = self.client.post(
                '/api/contacts/google/',
                {'access_token': 'ya29.' + 'a' * 30},
                format='json',
            )
        self.assertEqual(response.status_code, 502)

    def test_no_identifiers_produces_empty_result(self):
        with patch('messaging.google_contacts.fetch_google_contacts') as fetch:
            fetch.return_value = (set(), set(), 0)
            response = self.client.post(
                '/api/contacts/google/',
                {'access_token': 'ya29.' + 'a' * 30},
                format='json',
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['results'], [])

    def test_throttled_like_contact_match(self):
        with patch('messaging.google_contacts.fetch_google_contacts') as fetch:
            fetch.return_value = (set(), set(), 0)
            statuses = []
            for _ in range(25):
                response = self.client.post(
                    '/api/contacts/google/',
                    {'access_token': 'ya29.' + 'a' * 30},
                    format='json',
                )
                statuses.append(response.status_code)
        self.assertEqual(statuses[-1], 429, statuses)

    def test_google_matches_respect_block_and_privacy(self):
        from messaging.models import BlockedUser
        # Blocked → hidden.
        BlockedUser.objects.create(blocker=self.alice, blocked=self.bob)
        with patch('messaging.google_contacts.fetch_google_contacts') as fetch:
            fetch.return_value = ({self.bob.phone_number}, set(), 1)
            response = self.client.post(
                '/api/contacts/google/', {'access_token': 'ya29.' + 'a' * 30}, format='json',
            )
        self.assertEqual(response.data['results'], [])
        BlockedUser.objects.all().delete()
        # Opted out of phone discovery → hidden even from Google.
        self.bob.profile.discoverable_by_phone = False
        self.bob.profile.save()
        self.bob.refresh_from_db()
        with patch('messaging.google_contacts.fetch_google_contacts') as fetch:
            fetch.return_value = ({self.bob.phone_number}, set(), 1)
            response = self.client.post(
                '/api/contacts/google/', {'access_token': 'ya29.' + 'a' * 30}, format='json',
            )
        self.assertEqual(
            [r['id'] for r in response.data['results']],
            [],
        )
