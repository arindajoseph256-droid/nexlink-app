"""Token authentication endpoints used by the Expo client."""
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from rest_framework import permissions, status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes, throttle_classes, throttle_scope
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from .forms import RegisterForm
from .phones import normalize_e164
from .push_models import PushDevice

User = get_user_model()


def _user_payload(user):
    profile = getattr(user, 'profile', None)
    return {
        'id': user.id,
        'display_name': user.get_display_name(),
        'phone_number': user.phone_number,
        'email': user.email,
        'about': profile.bio if profile else '',
        'avatar_url': profile.avatar_url if profile else None,
    }


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
@throttle_classes([ScopedRateThrottle])
@throttle_scope('auth')
def login_api(request):
    identifier = (request.data.get('phone_number') or request.data.get('email') or '').strip()
    password = request.data.get('password') or ''
    user = None
    if '@' in identifier:
        user = User.objects.filter(email__iexact=identifier, is_active=True).first()
    else:
        try:
            phone = normalize_e164(identifier)
        except ValidationError:
            phone = None
        if phone:
            user = User.objects.filter(phone_number=phone, is_active=True).first()
    if user and not user.check_password(password):
        user = None
    if not user:
        return Response({'detail': 'Enter a correct phone number/email and password.'}, status=400)
    token, _ = Token.objects.get_or_create(user=user)
    return Response({'token': token.key, 'user': _user_payload(user)})


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
@throttle_classes([ScopedRateThrottle])
@throttle_scope('auth')
def register_api(request):
    form = RegisterForm(request.data)
    if not form.is_valid():
        return Response(form.errors, status=status.HTTP_400_BAD_REQUEST)
    user = form.save()
    token = Token.objects.create(user=user)
    return Response({'token': token.key, 'user': _user_payload(user)}, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def logout_api(request):
    Token.objects.filter(user=request.user).delete()
    return Response({'status': 'ok'})


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def me_api(request):
    return Response(_user_payload(request.user))


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def password_change_api(request):
    """Change the signed-in user's password (native clients, token auth).

    Mirrors the web ``accounts:password_change`` flow (Django's
    PasswordChangeForm) so web and mobile share identical validation.
    The DRF token stays valid — the user remains signed in on the device.
    """
    from django.contrib.auth.forms import PasswordChangeForm

    form = PasswordChangeForm(user=request.user, data=request.data)
    if form.is_valid():
        form.save()
        return Response({'status': 'ok'})
    detail = ' '.join(str(error) for errors in form.errors.values() for error in errors)
    return Response({'detail': detail or 'Password could not be changed.'}, status=400)


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def email_change_api(request):
    """Set (or clear, with an empty value) the account email address."""
    from .forms import UserEmailForm

    form = UserEmailForm(
        data={'email': request.data.get('email') or ''},
        instance=request.user,
    )
    if form.is_valid():
        form.save()
        return Response({'status': 'ok', 'email': request.user.email})
    detail = ' '.join(str(error) for errors in form.errors.values() for error in errors)
    return Response({'detail': detail or 'Email could not be updated.'}, status=400)


def _account_backup(user):
    """Serialise everything the viewer owns into a portable JSON document.

    Text content only: attachments are referenced by download URL because
    binary files cannot live inside a JSON backup. Messaging models are
    imported lazily so the accounts app never depends on messaging at
    import time.
    """
    from django.utils import timezone

    from .api_preferences import _preferences_payload
    from .models import UserPreferences
    from messaging.models import Contact, Conversation, MessageUserState

    profile = user.profile
    prefs = UserPreferences.for_user(user)

    contacts = [
        {
            'display_name': entry.contact.get_display_name(),
            'nickname': entry.nickname,
            'added_at': entry.created_at.isoformat() if entry.created_at else None,
        }
        for entry in Contact.objects.filter(owner=user).select_related('contact__profile')
    ]

    conversations = []
    message_count = 0
    qs = (
        Conversation.objects
        .filter(participants__user=user)
        .prefetch_related('participants__user__profile')
        .order_by('-updated_at')
    )
    for conversation in qs:
        rows = list(
            conversation.messages
            .exclude(hidden_for__user=user)
            .select_related('sender__profile')
            .order_by('-created_at')[:500]
        )
        rows.reverse()  # chronological in the exported file
        message_count += len(rows)
        conversations.append({
            'id': conversation.id,
            'kind': conversation.kind,
            'name': conversation.name,
            'description': conversation.description,
            'created_at': conversation.created_at.isoformat() if conversation.created_at else None,
            'participants': [
                member.user.get_display_name()
                for member in conversation.participants.all()
            ],
            'messages': [
                {
                    'id': row.id,
                    'sender': row.sender.get_display_name(),
                    'body': row.body,
                    'message_type': row.message_type,
                    'attachment': (
                        {
                            'name': row.attachment_name,
                            'mime_type': row.attachment_mime_type,
                            'size': row.attachment_size,
                            'download_path': f'/api/messages/{row.pk}/attachment/',
                        }
                        if row.attachment else None
                    ),
                    'is_deleted': row.is_deleted,
                    'created_at': row.created_at.isoformat(),
                }
                for row in rows
            ],
        })

    starred = [
        {
            'conversation_id': state.message.conversation_id,
            'message_id': state.message_id,
            'body': state.message.body,
            'starred_at': state.updated_at.isoformat() if state.updated_at else None,
        }
        for state in MessageUserState.objects
        .filter(user=user, is_starred=True)
        .select_related('message')
        .order_by('-updated_at')[:200]
    ]

    return {
        'schema': 'nexlink.backup.v1',
        'generated_at': timezone.now().isoformat(),
        'account': {
            'id': user.id,
            'phone_number': user.phone_number,
            'email': user.email,
            'username': user.username,
            'first_name': user.first_name,
            'date_joined': user.date_joined.isoformat() if user.date_joined else None,
        },
        'profile': {
            'display_name': profile.display_name,
            'bio': profile.bio,
            'photo_visibility': profile.photo_visibility,
            'about_visibility': profile.about_visibility,
            'last_seen_visibility': profile.last_seen_visibility,
            'online_visibility': profile.online_visibility,
        },
        'preferences': _preferences_payload(prefs),
        'contacts': contacts,
        'starred_messages': starred,
        'conversations': conversations,
        'counts': {
            'conversations': len(conversations),
            'messages': message_count,
            'contacts': len(contacts),
            'starred_messages': len(starred),
        },
    }


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def backup_api(request):
    """Download a JSON backup of the viewer's account data."""
    return Response(_account_backup(request.user))


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def backup_email_api(request):
    """Email the JSON backup to the account's recovery email address."""
    import json

    from django.conf import settings as django_settings
    from django.core.mail import EmailMessage
    from django.utils import timezone

    user = request.user
    if not user.email:
        return Response(
            {'detail': 'Set a recovery email first, then request the backup.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    payload = _account_backup(user)
    body = json.dumps(payload, indent=2, default=str)
    filename = f'nexlink-backup-{user.username}-{timezone.now():%Y%m%d}.json'
    email = EmailMessage(
        subject='Your Nexlink account backup',
        body=(
            'Attached is the JSON backup of your Nexlink account: profile, '
            'settings, contacts, starred messages and recent conversation '
            'history. Keep it somewhere safe. Attachments (photos/files) '
            'are referenced by download path, not embedded.'
        ),
        to=[user.email],
    )
    email.attach(filename, body, 'application/json')
    try:
        sent = email.send(fail_silently=False)
    except Exception:
        return Response(
            {'detail': 'The backup email could not be sent. Use Download backup instead.'},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    return Response({
        'status': 'ok',
        'email': user.email,
        'sent': bool(sent),
        # True when the server only logs mail (console backend): the file was
        # not actually delivered, so clients should offer Download instead.
        'console_backend': 'console' in (django_settings.EMAIL_BACKEND or ''),
    })


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def push_register_api(request):
    """Register this device's Expo push token for the signed-in user."""
    token = (request.data.get('token') or '').strip()
    if not token or len(token) > 255:
        return Response(
            {'detail': 'A push token is required (max 255 chars).'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    platform = (request.data.get('platform') or 'expo').strip()[:16]
    PushDevice.objects.update_or_create(
        token=token,
        defaults={'user': request.user, 'platform': platform},
    )
    return Response({'status': 'ok'})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def push_unregister_api(request):
    """Remove a push token (on logout or token refresh)."""
    token = (request.data.get('token') or '').strip()
    PushDevice.objects.filter(token=token, user=request.user).delete()
    return Response({'status': 'ok'})