"""Tests for the mobile app version-check endpoint (/api/mobile/version/)."""
from django.test import TestCase


class MobileVersionViewTests(TestCase):
    def test_endpoint_returns_defaults(self):
        response = self.client.get('/api/mobile/version/')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn('latest_version', data)
        self.assertIn('minimum_supported_version', data)
        self.assertIn('download_url', data)
        self.assertIn('release_notes', data)
        self.assertIn('update_required', data)
        self.assertIn('update_available', data)

    def test_installed_version_is_echoed(self):
        response = self.client.get('/api/mobile/version/?version=1.0.0')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['installed_version'], '1.0.0')

    def test_newer_installed_version_has_no_update(self):
        response = self.client.get('/api/mobile/version/?version=99.0.0')
        data = response.json()
        self.assertFalse(data['update_available'])
        self.assertFalse(data['update_required'])

    def test_missing_version_leaves_update_flags_false(self):
        response = self.client.get('/api/mobile/version/')
        data = response.json()
        self.assertFalse(data['update_available'])
        self.assertFalse(data['update_required'])
        self.assertIsNone(data['installed_version'])
