import { request } from './client';

/**
 * GET /api/mobile/version/?version=<installed>
 * Public endpoint (Django): returns latest_version, minimum_supported_version,
 * update_available, update_required, download_url and release_notes.
 */
export function checkAppVersion(installedVersion) {
  const query = installedVersion ? `?version=${encodeURIComponent(installedVersion)}` : '';
  return request(`/api/mobile/version/${query}`);
}
