"""Token query-param auth for binary endpoints (native clients).

React Native's Image/download components cannot send Authorization headers,
so the avatar and message-attachment endpoints accept ?token=<key> — the same
scheme the WebSocket layer already uses. Web session-cookie auth must be
untouched by these changes.
"""
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.authtoken.models import Token

from messaging.models import Conversation, ConversationParticipant, Message

User = get_user_model()


def _user(phone):
    return User.objects.create_user(
        phone_number=phone, email=f'{phone}@example.com', password='Str0ngPass!x',
    )


class AvatarTokenAuthTests(TestCase):
    def setUp(self):
        self.alice = _user('+256700000001')
        self.bob = _user('+256700000002')
        # alice has a picture on disk
        from django.core.files.uploadedfile import SimpleUploadedFile

        png = (
            b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01'
            b'\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01'
            b'\x00\x00\x05\x00\x01\r\n\x2d\xb4\x00\x00\x00\x00IEND\xaeB`\x82'
        )
        alice_profile = self.alice.profile
        alice_profile.picture.save('t.png', SimpleUploadedFile('t.png', png, 'image/png'), save=True)

    def test_web_session_still_works(self):
        self.client.force_login(self.alice)
        response = self.client.get(reverse('accounts:avatar', args=[self.alice.id]))
        self.assertEqual(response.status_code, 200)

    def test_token_query_param_allows_native_image_fetch(self):
        token = Token.objects.create(user=self.bob)
        response = self.client.get(
            reverse('accounts:avatar', args=[self.alice.id]) + f'?token={token.key}'
        )
        self.assertEqual(response.status_code, 200)

    def test_bad_token_is_json_401(self):
        response = self.client.get(
            reverse('accounts:avatar', args=[self.alice.id]) + '?token=not-a-key'
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()['detail'], 'Invalid or expired token.')

    def test_anonymous_without_token_redirects_to_login(self):
        response = self.client.get(reverse('accounts:avatar', args=[self.alice.id]))
        self.assertEqual(response.status_code, 302)
        self.assertIn('login', response['Location'])

    def test_no_picture_is_404_even_with_token(self):
        token = Token.objects.create(user=self.bob)
        response = self.client.get(
            reverse('accounts:avatar', args=[self.bob.id]) + f'?token={token.key}'
        )
        self.assertEqual(response.status_code, 404)


class AttachmentTokenAuthTests(TestCase):
    def setUp(self):
        self.alice = _user('+256700000011')
        self.bob = _user('+256700000012')
        self.stranger = _user('+256700000013')
        self.conversation = Conversation.objects.create()
        ConversationParticipant.objects.create(conversation=self.conversation, user=self.alice, is_admin=True)
        ConversationParticipant.objects.create(conversation=self.conversation, user=self.bob)
        from django.core.files.uploadedfile import SimpleUploadedFile

        self.message = Message.objects.create(
            conversation=self.conversation,
            sender=self.alice,
            message_type=Message.Type.FILE,
            body='',
            attachment=SimpleUploadedFile('notes.pdf', b'%PDF-1.4 test', 'application/pdf'),
        )
        self.token = Token.objects.create(user=self.bob)

    def _url(self, append_token=True):
        url = reverse('messaging_api:download_attachment', args=[self.message.id])
        return f'{url}?token={self.token.key}' if append_token else url

    def test_token_query_param_downloads_attachment(self):
        response = self.client.get(self._url())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(b''.join(response.streaming_content), b'%PDF-1.4 test')

    def test_token_header_still_works(self):
        response = self.client.get(
            reverse('messaging_api:download_attachment', args=[self.message.id]),
            HTTP_AUTHORIZATION=f'Token {self.token.key}',
        )
        self.assertEqual(response.status_code, 200)

    def test_anonymous_without_token_is_401(self):
        response = self.client.get(self._url(append_token=False))
        self.assertEqual(response.status_code, 401)

    def test_bad_token_is_401(self):
        response = self.client.get(
            reverse('messaging_api:download_attachment', args=[self.message.id]) + '?token=wrong'
        )
        self.assertEqual(response.status_code, 401)

    def test_valid_token_but_non_participant_is_404(self):
        stranger_token = Token.objects.create(user=self.stranger)
        response = self.client.get(
            reverse('messaging_api:download_attachment', args=[self.message.id]) + f'?token={stranger_token.key}'
        )
        self.assertEqual(response.status_code, 404)

    def test_participant_auth_rules_unchanged_for_web_session(self):
        self.client.force_login(self.bob)
        response = self.client.get(self._url(append_token=False))
        self.assertEqual(response.status_code, 200)
