"""Tests for contact discovery: normalization, matching, privacy, security.

Covers the acceptance criteria: phone/email normalization, duplicate and
invalid identifiers, discoverability settings, blocking, self-exclusion,
mutual contacts, shared groups, unauthenticated rejection, oversized
payloads and the enumeration-protection throttle.
"""
import json

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from .discovery import (
    collect_identifiers,
    match_users,
    normalize_email,
    normalize_phone,
    suggestions_for,
)
from .models import BlockedUser, Contact, ConversationParticipant
from .models import Conversation

User = get_user_model()


def make_user(phone, email=None, name=''):
    return User.objects.create_user(
        phone_number=phone,
        email=email,
        password='Passw0rd-Long!',
        first_name=name,
    )


class PhoneNormalizationTests(TestCase):
    def test_ugandan_local_and_international_agree(self):
        """0772123456, +256772123456 and 256772123456 are the same number."""
        with self.settings(DEFAULT_PHONE_REGION='UG'):
            local = normalize_phone('0772123456')
            plus = normalize_phone('+256772123456')
            bare = normalize_phone('256772123456')
        for form in (local, plus, bare):
            self.assertIn('+256772123456', form)

    def test_us_number_with_default_region(self):
        forms = normalize_phone('(415) 555-0100')
        self.assertIn('+14155550100', forms)

    def test_local_number_yields_international_reading_too(self):
        with self.settings(DEFAULT_PHONE_REGION='UG'):
            forms = normalize_phone('0772123456')
        self.assertIn('+256772123456', forms)

    def test_invalid_number_rejected(self):
        from django.core.exceptions import ValidationError
        with self.assertRaises(ValidationError):
            normalize_phone('not-a-phone')
        with self.assertRaises(ValidationError):
            normalize_phone('')
        with self.assertRaises(ValidationError):
            normalize_phone('123')  # too short to be valid anywhere

    def test_overlong_input_rejected(self):
        from django.core.exceptions import ValidationError
        with self.assertRaises(ValidationError):
            normalize_phone('9' * 40)


class EmailNormalizationTests(TestCase):
    def test_case_folding(self):
        self.assertEqual(normalize_email('John@Example.COM'), 'john@example.com')

    def test_invalid_email_rejected(self):
        from django.core.exceptions import ValidationError
        with self.assertRaises(ValidationError):
            normalize_email('not-an-email')
        with self.assertRaises(ValidationError):
            normalize_email('')


class CollectIdentifiersTests(TestCase):
    def test_deduplicates_and_counts_rejected(self):
        data = collect_identifiers({
            'phones': ['+14155551001', '4155551001', 'bad'],
            'emails': ['A@Example.com', 'a@example.com', 'nope'],
        })
        self.assertEqual(data['phones'], {'+14155551001'})
        self.assertEqual(data['emails'], {'a@example.com'})
        self.assertEqual(data['rejected'], 2)

    def test_size_limits(self):
        with self.assertRaises(ValueError):
            collect_identifiers({'phones': [f'+1415555{i:04d}' for i in range(201)]})
        with self.assertRaises(ValueError):
            collect_identifiers({'emails': [f'u{i}@x.com' for i in range(201)]})

    def test_malformed_payload_rejected(self):
        with self.assertRaises(ValueError):
            collect_identifiers(['not', 'a', 'dict'])
        with self.assertRaises(ValueError):
            collect_identifiers({'phones': 'string-not-list'})


class MatchTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alice = make_user('+14155551001', 'alice@example.com', 'Alice')
        cls.bob = make_user('+14155551002', 'bob@example.com', 'Bob')
        cls.carol = make_user('+256772123456', 'carol@example.com', 'Carol')
        cls.dave = make_user('+14155551004', 'dave@example.com', 'Dave')

    def setUp(self):
        Contact.objects.all().delete()
        BlockedUser.objects.all().delete()
        # Restore default discoverability (tests below flip these off).
        for user in (self.alice, self.bob, self.carol, self.dave):
            user.profile.discoverable_by_phone = True
            user.profile.discoverable_by_email = True
            user.profile.discoverable_in_suggestions = True
            user.profile.save()

    def test_phone_match_finds_registered_user(self):
        results = match_users(self.alice, phones={'+14155551002'})
        self.assertEqual([r['id'] for r in results], [self.bob.pk])

    def test_local_format_matches_international_storage(self):
        # Alice's contact book has Carol as a local Ugandan number.
        from django.core.exceptions import ValidationError
        with self.settings(DEFAULT_PHONE_REGION='UG'):
            forms = normalize_phone('0772123456')
        results = match_users(self.alice, phones=forms)
        self.assertIn(self.carol.pk, [r['id'] for r in results])

    def test_unregistered_numbers_return_nothing(self):
        results = match_users(self.alice, phones={'+14155559999'})
        self.assertEqual(results, [])

    def test_email_match_case_insensitive(self):
        results = match_users(self.alice, emails={'BOB@Example.com'})
        self.assertIn(self.bob.pk, [r['id'] for r in results])

    def test_no_private_fields_in_results(self):
        results = match_users(self.alice, phones={'+' + self.bob.phone_number.lstrip('+')},
                              emails={'bob@example.com'})
        row = next(r for r in results if r['id'] == self.bob.pk)
        self.assertNotIn('phone', row)
        self.assertNotIn('email', row)
        blob = json.dumps(row)
        self.assertNotIn(self.bob.phone_number, blob)
        self.assertNotIn('bob@example.com', blob)
        self.assertEqual(row['display_name'], 'Bob')

    def test_duplicate_sources_merge_into_one_entry(self):
        results = match_users(self.alice, phones={self.bob.phone_number}, emails={'bob@example.com'})
        rows = [r for r in results if r['id'] == self.bob.pk]
        self.assertEqual(len(rows), 1)
        self.assertEqual(set(rows[0]['sources']), {'phone', 'email'})

    def test_blocked_user_never_appears(self):
        BlockedUser.objects.create(blocker=self.alice, blocked=self.bob)
        results = match_users(self.alice, phones={self.bob.phone_number})
        self.assertEqual([r['id'] for r in results], [])
        # Reverse direction also hidden.
        results = match_users(self.bob, phones={self.alice.phone_number})
        self.assertEqual([r['id'] for r in results], [])

    def test_self_never_appears_in_own_results(self):
        results = match_users(self.alice, phones={self.alice.phone_number}, emails={'alice@example.com'})
        self.assertEqual([r['id'] for r in results], [])

    def test_phone_privacy_opt_out_hides_phone_matches_only(self):
        self.bob.profile.discoverable_by_phone = False
        self.bob.profile.save()
        results = match_users(self.alice, phones={self.bob.phone_number})
        self.assertEqual([r['id'] for r in results], [])
        # Email matching still allowed.
        results = match_users(self.alice, emails={'bob@example.com'})
        self.assertIn(self.bob.pk, [r['id'] for r in results])

    def test_email_privacy_opt_out_hides_email_matches_only(self):
        self.bob.profile.discoverable_by_email = False
        self.bob.profile.save()
        results = match_users(self.alice, emails={'bob@example.com'})
        self.assertEqual([r['id'] for r in results], [])
        results = match_users(self.alice, phones={self.bob.phone_number})
        self.assertIn(self.bob.pk, [r['id'] for r in results])

    def test_inactive_users_are_never_matched(self):
        self.bob.is_active = False
        self.bob.save(update_fields=['is_active'])
        results = match_users(self.alice, phones={self.bob.phone_number})
        self.assertEqual([r['id'] for r in results], [])


class SuggestionsTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alice = make_user('+14155552001', 'alice2@example.com', 'Alice')
        cls.bob = make_user('+14155552002', 'bob2@example.com', 'Bob')
        cls.carol = make_user('+14155552003', 'carol2@example.com', 'Carol')
        cls.dave = make_user('+14155552004', 'dave2@example.com', 'Dave')
        # Alice knows Bob; Bob knows Carol and Dave → Carol/Dave are mutuals of Bob.
        Contact.objects.create(owner=cls.alice, contact=cls.bob)
        Contact.objects.create(owner=cls.bob, contact=cls.carol)
        Contact.objects.create(owner=cls.bob, contact=cls.dave)
        Contact.objects.create(owner=cls.carol, contact=cls.bob)
        Contact.objects.create(owner=cls.dave, contact=cls.bob)
        # Shared group: Alice + Bob + Carol in one group.
        cls.group = Conversation.objects.create(kind=Conversation.Kind.GROUP, name='Team')
        ConversationParticipant.objects.create(conversation=cls.group, user=cls.alice)
        ConversationParticipant.objects.create(conversation=cls.group, user=cls.bob)
        ConversationParticipant.objects.create(conversation=cls.group, user=cls.carol)

    def test_contact_first_then_mutuals_then_group_peers(self):
        results = suggestions_for(self.alice, limit=20)
        ids = [r['id'] for r in results]
        self.assertIn(self.bob.pk, ids)          # saved contact
        self.assertIn(self.carol.pk, ids)        # group co-member with 1 mutual (Bob)
        self.assertNotIn(self.alice.pk, ids)     # never herself
        bob_row = next(r for r in results if r['id'] == self.bob.pk)
        self.assertEqual(bob_row['mutual_contacts'], 0)
        carol_row = next(r for r in results if r['id'] == self.carol.pk)
        self.assertEqual(carol_row['mutual_contacts'], 1)

    def test_shared_group_count_reported(self):
        results = suggestions_for(self.alice, limit=20)
        carol_row = next(r for r in results if r['id'] == self.carol.pk)
        self.assertEqual(carol_row['shared_groups'], 1)

    def test_blocked_user_filtered_from_suggestions(self):
        BlockedUser.objects.create(blocker=self.alice, blocked=self.dave)
        results = suggestions_for(self.alice, limit=20)
        self.assertNotIn(self.dave.pk, [r['id'] for r in results])

    def test_discoverability_opt_out_hides_from_suggestions(self):
        self.bob.profile.discoverable_in_suggestions = False
        self.bob.profile.save()
        results = suggestions_for(self.alice, limit=20)
        self.assertNotIn(self.bob.pk, [r['id'] for r in results])

    def test_no_fabricated_candidates(self):
        # A user with no relationships gets zero suggestions — never random users.
        stranger = make_user('+14155552099', 'stranger@example.com', 'Stranger')
        results = suggestions_for(stranger, limit=20)
        self.assertEqual(results, [])


class DiscoveryAPISecurityTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alice = make_user('+14155553001', 'alice3@example.com', 'Alice')
        cls.bob = make_user('+14155553002', 'bob3@example.com', 'Bob')

    def setUp(self):
        from django.core.cache import cache
        cache.clear()  # throttle state is process-global; isolate each test
        self.client = APIClient()
        self.client.force_login(self.alice)

    def test_unauthenticated_rejected(self):
        client = APIClient()
        response = client.post('/api/contacts/match/', {'phones': ['+14155553002']}, format='json')
        self.assertIn(response.status_code, (401, 403))
        response = client.get('/api/contacts/suggestions/')
        self.assertIn(response.status_code, (401, 403))

    def test_match_requires_authentication_and_returns_safe_shape(self):
        response = self.client.post(
            '/api/contacts/match/',
            {'phones': ['+14155553002'], 'source': 'phone_contacts'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['results']), 1)
        row = response.data['results'][0]
        for key in ('id', 'display_name', 'source', 'mutual_contacts', 'shared_groups', 'can_message'):
            self.assertIn(key, row)
        self.assertNotIn('phone', row)
        self.assertNotIn('email', row)

    def test_google_contacts_source_accepted(self):
        response = self.client.post(
            '/api/contacts/match/',
            {'emails': ['bob3@example.com'], 'source': 'google_contacts'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['results'][0]['source'], 'google_contacts')

    def test_unknown_source_rejected(self):
        response = self.client.post('/api/contacts/match/', {'phones': [], 'source': 'gmail'}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_oversized_payload_rejected(self):
        big = {'phones': ['+1415555%04d' % i for i in range(500)]}
        response = self.client.post('/api/contacts/match/', big, format='json')
        self.assertEqual(response.status_code, 400)

    def test_all_invalid_identifiers_rejected(self):
        response = self.client.post('/api/contacts/match/', {'phones': ['garbage']}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_suggestions_endpoint_shape(self):
        response = self.client.get('/api/contacts/suggestions/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('results', response.data)

    def test_throttling_blocks_enumeration(self):
        """Burst above the 20/minute contact_match scope → 429."""
        from django.core.cache import cache
        cache.clear()
        statuses = []
        for _ in range(25):
            response = self.client.post(
                '/api/contacts/match/',
                {'phones': ['+14155553002'], 'source': 'phone_contacts'},
                format='json',
            )
            statuses.append(response.status_code)
        self.assertEqual(statuses[-1], 429, statuses)

    def test_rate_limit_rejects_bulk_enumeration_lists(self):
        """A 200-number probe list must not leak registered status (200-number cap → 400 above it, matches are filtered)."""
        phones = [f'+1415555{1000 + i}' for i in range(200)]  # none registered
        response = self.client.post('/api/contacts/match/', {'phones': phones}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['results'], [])
