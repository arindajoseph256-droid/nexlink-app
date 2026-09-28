"""Shared SEO metadata helpers for public pages.

All absolute URLs derive from settings.SITE_URL so production always emits
https://nexlink-app.onrender.com and development stays on localhost without
hardcoding either.
"""
import json

from django.conf import settings

BRAND = 'Nexlink'

HOME_TITLE = 'Nexlink — Modern Messaging & Chat App'
HOME_DESCRIPTION = (
    'Nexlink is a modern messaging and chat web app for private, real-time '
    'conversations — create a free account and connect with your people online.'
)

SOCIAL_IMAGE_PATH = 'images/icon-512.png'


def _asset(name):
    return settings.STATIC_URL + name


def page_meta(request, title, description, path='/'):
    """Build a template context dict with canonical + social metadata."""
    canonical = settings.SITE_URL + path
    image = settings.SITE_URL + _asset(SOCIAL_IMAGE_PATH)
    return {
        'seo_title': title,
        'seo_description': description,
        'seo_canonical': canonical,
        'seo_url': canonical,
        'seo_site_name': BRAND,
        'seo_image': image,
        'seo_google_verification': getattr(settings, 'GOOGLE_SITE_VERIFICATION', ''),
    }


def home_meta(request):
    meta = page_meta(request, HOME_TITLE, HOME_DESCRIPTION, '/')
    meta['seo_json_ld'] = json.dumps({
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        'name': BRAND,
        'url': settings.SITE_URL + '/',
        'applicationCategory': 'CommunicationApplication',
        'operatingSystem': 'Web',
        'browserRequirements': 'Requires JavaScript',
        'description': HOME_DESCRIPTION,
        'inLanguage': 'en',
        'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'USD'},
        'featureList': [
            'Private messaging',
            'Group chats',
            'Photo, video, audio and document sharing',
            'Voice and video calls',
            'Real-time delivery and read receipts',
            'Installable web app (PWA)',
        ],
    })
    return meta
