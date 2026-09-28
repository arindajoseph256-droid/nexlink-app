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