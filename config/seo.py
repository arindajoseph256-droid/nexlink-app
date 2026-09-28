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
        'seo_bing_verification': getattr(settings, 'BING_SITE_VERIFICATION', ''),
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
    faq_items = [
        {
            'q': 'What is the Nexlink app?',
            'a': 'Nexlink is a free online messaging app that runs in your browser. '
                 'It works on phones, tablets and desktops from the same account.',
        },
        {
            'q': 'Is Nexlink free to use?',
            'a': 'Yes. Nexlink is free — create an account with your phone number '
                 'and start chatting. There is no paid plan or hidden fee.',
        },
        {
            'q': 'Do I need to install anything to use Nexlink online?',
            'a': 'No. The Nexlink web app runs directly in Chrome, Safari, Firefox '
                 'and Edge. On Android you can also install it as an app.',
        },
        {
            'q': 'Is Nexlink messenger private?',
            'a': 'Your conversations are private to you and the people you chat '
                 'with. You control last seen, read receipts and typing indicators.',
        },
    ]
    meta['seo_faq'] = faq_items
    meta['seo_faq_json_ld'] = json.dumps({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        'mainEntity': [
            {
                '@type': 'Question',
                'name': item['q'],
                'acceptedAnswer': {'@type': 'Answer', 'text': item['a']},
            }
            for item in faq_items
        ],
    })
    return meta
