"""Tests for the messaging app: API authz, conversations, messages, reactions."""
import asyncio
import json

from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient

from . import consumers
from .models import (
    BlockedUser, Contact, Conversation, Message, Notification, Reaction, UserReport,
)

User = get_user_model()


class MessagingTestBase(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alice = User.objects.create_user(
            phone_number='+14155551001', email='alice@example.com', password='Passw0rd-Long!',
        )
        cls.bob = User.objects.create_user(
            phone_number='+14155551002', email='bob@example.com', password='Passw0rd-Long!',
        )
        cls.mallory = User.objects.create_user(
            phone_number='+14155551003', email='mallory@example.com', password='Passw0rd-Long!',
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_login(self.alice)


class ConversationAPITests(MessagingTestBase):
    def test_start_conversation_creates_pair(self):
        response = self.client.post('/api/conversations/start/', {'user_id': self.bob.id})
        self.assertEqual(response.status_code, 201)
        conversation_id = response.data['id']

        # Second call returns the same conversation (idempotent).
        response = self.client.post('/api/conversations/start/', {'user_id': self.bob.id})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['id'], conversation_id)

        self.assertTrue(self.alice.conversation_memberships.filter(
            conversation_id=conversation_id).exists())
        self.assertTrue(self.bob.conversation_memberships.filter(
            conversation_id=conversation_id).exists())

    def test_start_conversation_requires_user_id(self):
        response = self.client.post('/api/conversations/start/', {})
        self.assertEqual(response.status_code, 400)

    def test_start_conversation_with_self_rejected(self):
        response = self.client.post('/api/conversations/start/', {'user_id': self.alice.id})
        self.assertEqual(response.status_code, 404)

    def test_conversation_list_only_shows_own(self):
        self.client.post('/api/conversations/start/', {'user_id': self.bob.id})
        response = self.client.get('/api/conversations/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

        # Mallory sees nothing.
        self.client.force_login(self.mallory)
        response = self.client.get('/api/conversations/')
        self.assertEqual(len(response.data), 0)

    def test_conversation_list_keeps_all_previous_chats_visible(self):
        conversation, _ = Conversation.get_or_create_between(self.alice, self.bob)
        conversation.participant_for(self.alice).is_hidden = True
        conversation.participant_for(self.alice).save(update_fields=['is_hidden'])
        response = self.client.get('/api/conversations/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item['id'] for item in response.data], [conversation.id])


class MessageAPITests(MessagingTestBase):
    def setUp(self):
        super().setUp()
        self.conversation, _ = Conversation.get_or_create_between(self.alice, self.bob)
        self.messages_url = f'/api/conversations/{self.conversation.id}/messages/'

    def test_send_message(self):
        response = self.client.post(self.messages_url, {'body': 'Hello Bob!'})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['body'], 'Hello Bob!')
        self.assertEqual(response.data['sender']['id'], self.alice.id)
        self.assertTrue(Notification.objects.filter(
            recipient=self.bob, message_id=response.data['id'],
        ).exists())

    def test_unsupported_attachment_rejected(self):
        response = self.client.post(self.messages_url, {
            'message_type': 'image',
            'attachment': SimpleUploadedFile(
                'payload.exe', b'not-an-image', content_type='application/octet-stream',
            ),
        }, format='multipart')
        self.assertEqual(response.status_code, 400)

    def test_send_message_with_reply(self):
        parent = Message.objects.create(
            conversation=self.conversation, sender=self.bob, body='Hi Alice',
        )
        response = self.client.post(self.messages_url, {
            'body': 'Replying!', 'reply_to': parent.id,
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['reply_to']['id'], parent.id)

    def test_empty_message_rejected(self):
        response = self.client.post(self.messages_url, {'body': '   '})
        self.assertEqual(response.status_code, 400)

    def test_non_participant_cannot_read(self):
        self.client.force_login(self.mallory)
        response = self.client.get(self.messages_url)
        self.assertEqual(response.status_code, 403)

    def test_non_participant_cannot_send(self):
        self.client.force_login(self.mallory)
        response = self.client.post(self.messages_url, {'body': 'intruding'})
        self.assertEqual(response.status_code, 403)

    def test_non_participant_cannot_mark_read(self):
        self.client.force_login(self.mallory)
        response = self.client.post(f'/api/conversations/{self.conversation.id}/read/')
        self.assertEqual(response.status_code, 403)

    def test_mark_read_updates_participant(self):
        Message.objects.create(conversation=self.conversation, sender=self.bob, body='Hey')
        response = self.client.post(f'/api/conversations/{self.conversation.id}/read/')
        self.assertEqual(response.status_code, 200)
        participant = self.conversation.participant_for(self.alice)
        self.assertIsNotNone(participant.last_read_message)

    def test_edit_own_message(self):
        message = Message.objects.create(
            conversation=self.conversation, sender=self.alice, body='Original',
        )
        response = self.client.patch(f'/api/messages/{message.id}/edit/', {'body': 'Edited!'})
        self.assertEqual(response.status_code, 200)
        message.refresh_from_db()
        self.assertEqual(message.body, 'Edited!')
        self.assertIsNotNone(message.edited_at)

    def test_cannot_edit_others_message(self):
        message = Message.objects.create(
            conversation=self.conversation, sender=self.bob, body='Bob says',
        )
        response = self.client.patch(f'/api/messages/{message.id}/edit/', {'body': 'hacked'})
        self.assertEqual(response.status_code, 403)

    def test_delete_own_message_soft_deletes(self):
        message = Message.objects.create(
            conversation=self.conversation, sender=self.alice, body='Bye',
        )
        response = self.client.delete(f'/api/messages/{message.id}/delete/')
        self.assertEqual(response.status_code, 204)
        message.refresh_from_db()
        self.assertTrue(message.is_deleted)
        self.assertEqual(message.body, '')

    def test_delete_for_me_hides_message_only_for_viewer(self):
        message = Message.objects.create(
            conversation=self.conversation, sender=self.bob, body='Private removal',
        )
        response = self.client.delete(f'/api/messages/{message.id}/delete-for-me/')
        self.assertEqual(response.status_code, 204)
        response = self.client.get(self.messages_url)
        self.assertEqual(response.data['results'], [])
        self.client.force_login(self.bob)
        response = self.client.get(self.messages_url)
        self.assertEqual(len(response.data['results']), 1)

    def test_cannot_delete_others_message(self):
        message = Message.objects.create(
            conversation=self.conversation, sender=self.bob, body='Keep me',
        )
        response = self.client.delete(f'/api/messages/{message.id}/delete/')
        self.assertEqual(response.status_code, 403)


class ReactionAPITests(MessagingTestBase):
    def setUp(self):
        super().setUp()
        self.conversation, _ = Conversation.get_or_create_between(self.alice, self.bob)
        self.message = Message.objects.create(
            conversation=self.conversation, sender=self.bob, body='React to me',
        )

    def test_toggle_reaction_on_and_off(self):
        response = self.client.post(f'/api/messages/{self.message.id}/react/',
                                    {'emoji': '👍'})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['added'])
        self.assertEqual(Reaction.objects.filter(message=self.message).count(), 1)

        response = self.client.post(f'/api/messages/{self.message.id}/react/',
                                    {'emoji': '👍'})
        self.assertFalse(response.data['added'])
        self.assertEqual(Reaction.objects.filter(message=self.message).count(), 0)

    def test_invalid_emoji_rejected(self):
        response = self.client.post(f'/api/messages/{self.message.id}/react/',
                                    {'emoji': 'x' * 20})
        self.assertEqual(response.status_code, 400)

    def test_non_participant_cannot_react(self):
        self.client.force_login(self.mallory)
        response = self.client.post(f'/api/messages/{self.message.id}/react/',
                                    {'emoji': '👍'})
        self.assertEqual(response.status_code, 403)


class UserSearchTests(MessagingTestBase):
    def test_chat_people_returns_people_from_existing_chats(self):
        Conversation.get_or_create_between(self.alice, self.bob)
        response = self.client.get('/api/chats/people/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([person['id'] for person in response.data['results']], [self.bob.id])
        self.assertEqual(response.data['results'][0]['masked_phone'], self.bob.masked_phone)

    def test_search_finds_by_phone(self):
        response = self.client.get('/api/users/search/', {'q': '+14155551002'})
        self.assertEqual(response.status_code, 200)
        ids = [r['id'] for r in response.data['results']]
        self.assertIn(self.bob.id, ids)
        self.assertNotIn(self.alice.id, ids)

    def test_search_finds_by_exact_email(self):
        response = self.client.get('/api/users/search/', {'q': 'bob@example.com'})
        self.assertEqual(response.status_code, 200)
        ids = [result['id'] for result in response.data['results']]
        self.assertEqual(ids, [self.bob.id])

    def test_search_finds_by_display_name(self):
        self.bob.profile.display_name = 'The Bobster'
        self.bob.profile.save()
        Conversation.get_or_create_between(self.alice, self.bob)
        response = self.client.get('/api/users/search/', {'q': 'Bobster'})
        ids = [r['id'] for r in response.data['results']]
        self.assertIn(self.bob.id, ids)

    def test_name_search_does_not_expose_unknown_registered_users(self):
        self.bob.profile.display_name = 'Known Bob'
        self.bob.profile.save()
        response = self.client.get('/api/users/search/', {'q': 'Known'})
        self.assertEqual(response.data['results'], [])

    def test_search_requires_auth(self):
        client = APIClient()
        response = client.get('/api/users/search/', {'q': 'bob'})
        self.assertEqual(response.status_code, 403)

    def test_block_hides_user_and_prevents_new_conversation(self):
        response = self.client.post(f'/api/users/{self.bob.id}/block/')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(BlockedUser.objects.filter(blocker=self.alice, blocked=self.bob).exists())
        response = self.client.get('/api/users/search/', {'q': '+14155551002'})
        self.assertEqual(response.data['results'], [])
        response = self.client.post('/api/conversations/start/', {'user_id': self.bob.id})
        self.assertEqual(response.status_code, 403)


class ContactAPITests(MessagingTestBase):
    def test_contacts_are_private_and_idempotent(self):
        response = self.client.post('/api/contacts/', {'user_id': self.bob.id, 'nickname': 'Bobby'})
        self.assertEqual(response.status_code, 201)
        response = self.client.post('/api/contacts/', {'user_id': self.bob.id, 'nickname': 'Bob'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Contact.objects.filter(owner=self.alice).count(), 1)
        self.assertEqual(response.data['nickname'], 'Bob')
        self.client.force_login(self.bob)
        response = self.client.get('/api/contacts/')
        self.assertEqual(response.data['results'], [])


class NexusStateAPITests(MessagingTestBase):
    """Per-user conversation/message state + preferences for the Nexus UI."""

    def _conversation(self):
        response = self.client.post('/api/conversations/start/', {'user_id': self.bob.id})
        return response.data['id']

    def _message(self, conversation_id):
        response = self.client.post(
            f'/api/conversations/{conversation_id}/messages/', {'body': 'hello'},
        )
        return response.data['id']

    def test_conversation_state_flags_roundtrip(self):
        conversation_id = self._conversation()
        response = self.client.patch(
            f'/api/conversations/{conversation_id}/state/',
            {'pinned': True, 'muted': True, 'archived': False},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['pinned'])
        self.assertTrue(response.data['muted'])

        listing = self.client.get('/api/conversations/').data
        row = next(c for c in listing if c['id'] == conversation_id)
        self.assertTrue(row['pinned'])
        self.assertTrue(row['muted'])

    def test_conversation_state_requires_participation(self):
        conversation_id = self._conversation()
        self.client.force_login(self.mallory)
        response = self.client.patch(
            f'/api/conversations/{conversation_id}/state/', {'pinned': True},
        )
        self.assertEqual(response.status_code, 403)

    def test_message_star_and_pin_toggle(self):
        conversation_id = self._conversation()
        message_id = self._message(conversation_id)

        starred = self.client.post(f'/api/messages/{message_id}/star/')
        self.assertEqual(starred.status_code, 200)
        self.assertTrue(starred.data['starred'])

        pinned = self.client.post(f'/api/messages/{message_id}/pin/')
        self.assertEqual(pinned.status_code, 200)
        self.assertTrue(pinned.data['pinned'])

        listing = self.client.get(
            f'/api/conversations/{conversation_id}/messages/',
        ).data['results']
        row = next(m for m in listing if m['id'] == message_id)
        self.assertTrue(row['starred'])
        self.assertTrue(row['pinned'])

        # Toggle off.
        self.assertFalse(self.client.post(f'/api/messages/{message_id}/star/').data['starred'])

    def test_clear_chat_hides_only_for_viewer(self):
        conversation_id = self._conversation()
        self._message(conversation_id)
        self.client.force_login(self.bob)
        self.client.post(
            f'/api/conversations/{conversation_id}/messages/', {'body': 'from bob'},
        )

        # Alice clears her view of the conversation.
        self.client.force_login(self.alice)
        response = self.client.post(f'/api/conversations/{conversation_id}/clear/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self.client.get(f'/api/conversations/{conversation_id}/messages/').data['results'],
            [],
        )

        # Bob still sees the history.
        self.client.force_login(self.bob)
        self.assertTrue(
            self.client.get(f'/api/conversations/{conversation_id}/messages/').data['results'],
        )

    def test_starred_messages_endpoint(self):
        conversation_id = self._conversation()
        message_id = self._message(conversation_id)
        self.client.post(f'/api/messages/{message_id}/star/')
        response = self.client.get('/api/messages/starred/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([m['id'] for m in response.data['results']], [message_id])

    def test_preferences_roundtrip_and_me_full(self):
        response = self.client.patch('/api/auth/preferences/', {
            'theme': 'light', 'accent': '#ec4899', 'status': 'dnd', 'sounds': False,
        }, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['theme'], 'light')
        self.assertEqual(response.data['accent'], '#ec4899')
        self.assertEqual(response.data['status'], 'dnd')
        self.assertFalse(response.data['sounds'])

        me = self.client.get('/api/auth/me/full/').data
        self.assertEqual(me['preferences']['theme'], 'light')

    def test_profile_patch_via_me_full(self):
        response = self.client.patch('/api/auth/me/full/', {
            'display_name': 'Alice N.', 'about': 'Hello there',
        }, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['display_name'], 'Alice N.')
        self.assertEqual(response.data['about'], 'Hello there')


class NexusCallAPITests(MessagingTestBase):
    """Phase 6.1: 1:1 voice/video calls with socket-relayed WebRTC signaling."""

    def setUp(self):
        super().setUp()
        self.conversation, _ = Conversation.get_or_create_between(self.alice, self.bob)
        self.start_url = f'/api/conversations/{self.conversation.id}/calls/'

    def _start_call(self, kind='voice'):
        response = self.client.post(self.start_url, {'kind': kind}, format='json')
        self.assertEqual(response.status_code, 201)
        return response.data

    def test_call_start_returns_ring_payload(self):
        payload = self._start_call('video')
        self.assertEqual(payload['kind'], 'video')
        self.assertEqual(payload['status'], 'ringing')
        self.assertEqual(payload['direction'], 'outgoing')
        self.assertEqual(payload['peer']['id'], self.bob.id)
        self.assertIsNone(payload['duration_seconds'])

    def test_call_start_defaults_to_voice(self):
        response = self.client.post(self.start_url, {})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['kind'], 'voice')

    def test_call_start_invalid_kind_rejected(self):
        response = self.client.post(self.start_url, {'kind': 'telepathy'}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_call_start_blocked_users_rejected(self):
        BlockedUser.objects.create(blocker=self.alice, blocked=self.bob)
        response = self.client.post(self.start_url, {})
        self.assertEqual(response.status_code, 403)

    def test_call_start_non_participant_forbidden(self):
        self.client.force_login(self.mallory)
        response = self.client.post(self.start_url, {})
        self.assertEqual(response.status_code, 403)

    def test_call_start_group_conversation_rejected(self):
        response = self.client.post('/api/groups/', {
            'name': 'Team', 'user_ids': [self.bob.id, self.mallory.id],
        }, format='json')
        response = self.client.post(f"/api/conversations/{response.data['id']}/calls/", {})
        self.assertEqual(response.status_code, 400)

    def test_double_ring_returns_409(self):
        self._start_call()
        response = self.client.post(self.start_url, {})
        self.assertEqual(response.status_code, 409)

    def test_full_answer_signal_end_lifecycle(self):
        call_id = self._start_call()['id']

        # Mallory is not part of the call.
        self.client.force_login(self.mallory)
        self.assertEqual(self.client.post(f'/api/calls/{call_id}/answer/').status_code, 400)
        self.assertEqual(self.client.post(f'/api/calls/{call_id}/decline/').status_code, 403)
        self.assertEqual(self.client.post(f'/api/calls/{call_id}/end/').status_code, 403)
        self.assertEqual(self.client.post(
            f'/api/calls/{call_id}/signal/',
            {'signal_type': 'ice', 'payload': {'candidate': 'x'}},
            format='json',
        ).status_code, 403)

        # The callee answers and relays ICE back to the caller.
        self.client.force_login(self.bob)
        answered = self.client.post(f'/api/calls/{call_id}/answer/')
        self.assertEqual(answered.status_code, 200)
        self.assertEqual(answered.data['status'], 'active')
        self.assertEqual(answered.data['direction'], 'incoming')

        relayed = self.client.post(
            f'/api/calls/{call_id}/signal/',
            {'signal_type': 'ice', 'payload': {'candidate': 'x'}},
            format='json',
        )
        self.assertEqual(relayed.status_code, 200)

        # The caller ends the active call; duration is computed.
        self.client.force_login(self.alice)
        ended = self.client.post(f'/api/calls/{call_id}/end/')
        self.assertEqual(ended.status_code, 200)
        self.assertEqual(ended.data['status'], 'ended')
        self.assertGreaterEqual(ended.data['duration_seconds'], 0)

    def test_decline_marks_call_declined(self):
        call_id = self._start_call()['id']
        self.client.force_login(self.bob)
        declined = self.client.post(f'/api/calls/{call_id}/decline/')
        self.assertEqual(declined.data['status'], 'declined')

    def test_end_before_answer_marks_missed(self):
        call_id = self._start_call()['id']
        ended = self.client.post(f'/api/calls/{call_id}/end/')
        self.assertEqual(ended.data['status'], 'missed')

    def test_cannot_answer_non_ringing_call(self):
        call_id = self._start_call()['id']
        self.client.force_login(self.bob)
        self.client.post(f'/api/calls/{call_id}/decline/')
        response = self.client.post(f'/api/calls/{call_id}/answer/')
        self.assertEqual(response.status_code, 400)

    def test_signal_requires_valid_type(self):
        call_id = self._start_call()['id']
        response = self.client.post(
            f'/api/calls/{call_id}/signal/', {'signal_type': 'hijack'}, format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_call_history_lists_calls_for_both_parties(self):
        call_id = self._start_call()['id']

        response = self.client.get('/api/calls/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['id'] for row in response.data['results']], [call_id])

        self.client.force_login(self.bob)
        row = self.client.get('/api/calls/').data['results'][0]
        self.assertEqual(row['id'], call_id)
        self.assertEqual(row['direction'], 'incoming')
        self.assertEqual(row['peer']['id'], self.alice.id)


class NexusMediaGalleryTests(MessagingTestBase):
    """Phase 6.2: attachments + shared links surfaced in the info panel."""

    def setUp(self):
        super().setUp()
        self.conversation, _ = Conversation.get_or_create_between(self.alice, self.bob)
        self.media_url = f'/api/conversations/{self.conversation.id}/media/'

    def test_media_returns_attachments_and_extracted_links(self):
        Message.objects.create(
            conversation=self.conversation, sender=self.alice,
            message_type=Message.Type.IMAGE,
            attachment=SimpleUploadedFile('pic.png', b'fake-bytes', content_type='image/png'),
        )
        Message.objects.create(
            conversation=self.conversation, sender=self.bob,
            body='Docs at https://example.com/page, mirror https://other.org.',
        )
        Message.objects.create(
            conversation=self.conversation, sender=self.alice, body='No links here.',
        )

        response = self.client.get(self.media_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['media']), 1)
        self.assertEqual(response.data['media'][0]['message_type'], 'image')
        self.assertEqual(
            [link['url'] for link in response.data['links']],
            ['https://example.com/page', 'https://other.org'],
        )
        self.assertEqual(response.data['links'][0]['sender'], self.bob.get_display_name())

    def test_media_excludes_deleted_and_personally_hidden_messages(self):
        image = Message.objects.create(
            conversation=self.conversation, sender=self.alice,
            message_type=Message.Type.IMAGE,
            attachment=SimpleUploadedFile('gone.png', b'x', content_type='image/png'),
        )
        image.soft_delete()
        hidden = Message.objects.create(
            conversation=self.conversation, sender=self.bob,
            body='https://hidden.example/secret',
        )
        hidden.hidden_for.create(user=self.alice)

        response = self.client.get(self.media_url)
        self.assertEqual(response.data['media'], [])
        self.assertEqual(response.data['links'], [])

    def test_media_requires_participation(self):
        self.client.force_login(self.mallory)
        self.assertEqual(self.client.get(self.media_url).status_code, 403)


class ReportUserTests(MessagingTestBase):
    def test_report_validates_reason_and_auto_blocks(self):
        response = self.client.post(
            f'/api/users/{self.bob.id}/report/', {'reason': 'nonsense'}, format='json',
        )
        self.assertEqual(response.status_code, 400)

        response = self.client.post(f'/api/users/{self.bob.id}/report/', {
            'reason': 'harassment', 'details': 'Repeated abusive messages.',
        }, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertTrue(UserReport.objects.filter(
            reporter=self.alice, reported=self.bob, reason='harassment',
            details__contains='abusive',
        ).exists())
        # Reporting automatically blocks the reported user.
        self.assertTrue(
            BlockedUser.objects.filter(blocker=self.alice, blocked=self.bob).exists(),
        )

    def test_report_self_and_unknown_users_rejected(self):
        self.assertEqual(
            self.client.post(f'/api/users/{self.alice.id}/report/',
                             {'reason': 'spam'}, format='json').status_code,
            404,
        )
        self.assertEqual(
            self.client.post('/api/users/999999/report/',
                             {'reason': 'spam'}, format='json').status_code,
            404,
        )

    def test_block_toggle_roundtrip(self):
        self.assertEqual(
            self.client.post(f'/api/users/{self.bob.id}/block/').data['status'], 'blocked',
        )
        self.assertTrue(
            BlockedUser.objects.filter(blocker=self.alice, blocked=self.bob).exists(),
        )
        self.assertEqual(
            self.client.delete(f'/api/users/{self.bob.id}/block/').data['status'],
            'unblocked',
        )
        self.assertFalse(
            BlockedUser.objects.filter(blocker=self.alice, blocked=self.bob).exists(),
        )


class NexusDashboardPageTests(MessagingTestBase):
    def test_dashboard_renders_for_signed_in_user(self):
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'nexus.js')
        self.assertContains(response, 'NEXUS_BOOT')

    def test_dashboard_requires_authentication(self):
        self.client.logout()
        response = self.client.get('/')
        self.assertEqual(response.status_code, 302)
        self.assertIn('/accounts/login/', response.url)


class GroupAPITests(MessagingTestBase):
    def test_admin_can_create_and_manage_group(self):
        response = self.client.post('/api/groups/', {
            'name': 'Project chat',
            'description': 'Planning',
            'user_ids': [self.bob.id, self.mallory.id],
        }, format='json')
        self.assertEqual(response.status_code, 201)
        group_id = response.data['id']
        self.assertEqual(len(response.data['participants']), 3)

        response = self.client.post(
            f'/api/groups/{group_id}/admins/{self.bob.id}/', {}, format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(next(
            member for member in response.data['participants'] if member['id'] == self.bob.id
        )['is_admin'])

    def test_non_admin_cannot_manage_group(self):
        response = self.client.post('/api/groups/', {
            'name': 'Project chat', 'user_ids': [self.bob.id],
        }, format='json')
        group_id = response.data['id']
        self.client.force_login(self.bob)
        response = self.client.post(
            f'/api/groups/{group_id}/members/', {'user_id': self.mallory.id}, format='json',
        )
        self.assertEqual(response.status_code, 403)


class UnreadCountTests(MessagingTestBase):
    def test_unread_count_flow(self):
        self.conversation, _ = Conversation.get_or_create_between(self.alice, self.bob)
        Message.objects.create(conversation=self.conversation, sender=self.bob, body='One')
        Message.objects.create(conversation=self.conversation, sender=self.bob, body='Two')

        response = self.client.get('/api/conversations/')
        conversation = response.data[0]
        self.assertEqual(conversation['unread_count'], 2)

        # Alice reads everything.
        self.client.post(f'/api/conversations/{self.conversation.id}/read/')
        response = self.client.get('/api/conversations/')
        self.assertEqual(response.data[0]['unread_count'], 0)


class WebSocketChatTests(TransactionTestCase):
    """Async consumer tests using Channels' WebsocketCommunicator.

    Uses TransactionTestCase because the consumer's database access runs in
    a separate thread/connection that cannot see uncommitted TestCase data.
    """

    def setUp(self):
        self.alice = User.objects.create_user(
            phone_number='+14155551101', email='w_alice@example.com', password='Passw0rd-Long!',
        )
        self.bob = User.objects.create_user(
            phone_number='+14155551102', email='w_bob@example.com', password='Passw0rd-Long!',
        )
        self.mallory = User.objects.create_user(
            phone_number='+14155551103', email='w_mallory@example.com', password='Passw0rd-Long!',
        )

    def _make_communicator(self, user, conversation_id):
        # Mount the consumer directly: AuthMiddlewareStack (in the real ASGI
        # app) rebuilds scope['user'] from session cookies, which don't exist
        # in tests, so injecting the user into the raw scope is the reliable
        # way to exercise our consumer's own logic.
        communicator = WebsocketCommunicator(
            consumers.ChatConsumer.as_asgi(),
            f'/ws/chat/{conversation_id}/',
        )
        communicator.scope['user'] = user
        communicator.scope['url_route'] = {'kwargs': {'conversation_id': str(conversation_id)}}
        return communicator

    def _run(self, coroutine):
        return asyncio.new_event_loop().run_until_complete(coroutine)

    def test_participant_can_connect_and_receive(self):
        conversation, _ = Conversation.get_or_create_between(self.alice, self.bob)

        async def run():
            alice = self._make_communicator(self.alice, conversation.id)
            bob = self._make_communicator(self.bob, conversation.id)
            connected_a, _ = await alice.connect()
            connected_b, _ = await bob.connect()
            self.assertTrue(connected_a)
            self.assertTrue(connected_b)

            # Drain each consumer's 'connected' greeting (skips other frames).
            await self._receive_json(alice)
            await self._receive_json(bob)

            await alice.send_json_to({'type': 'typing', 'is_typing': True})
            event = await self._receive_json(bob)
            self.assertEqual(event['type'], 'typing.event')
            self.assertTrue(event['is_typing'])
            self.assertEqual(event['user_id'], self.alice.id)

            await alice.disconnect()
            await bob.disconnect()

        self._run(run())

    async def _receive_json(self, communicator):
        """Read frames until a JSON text frame arrives."""
        while True:
            frame = await communicator.receive_output(timeout=2)
            if frame['type'] == 'websocket.send':
                return json.loads(frame['text'])

    def test_non_participant_rejected(self):
        conversation, _ = Conversation.get_or_create_between(self.alice, self.bob)

        async def run():
            communicator = self._make_communicator(self.mallory, conversation.id)
            # connect() consumes the close frame and reports not-connected.
            connected, _code = await communicator.connect()
            self.assertFalse(connected)

        self._run(run())

    def test_unauthenticated_rejected(self):
        async def run():
            from django.contrib.auth.models import AnonymousUser
            communicator = WebsocketCommunicator(
                consumers.ChatConsumer.as_asgi(), '/ws/chat/1/',
            )
            communicator.scope['user'] = AnonymousUser()
            communicator.scope['url_route'] = {'kwargs': {'conversation_id': '1'}}
            connected, _code = await communicator.connect()
            self.assertFalse(connected)

        self._run(run())
