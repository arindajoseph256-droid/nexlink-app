import React, { useEffect, useState } from 'react';
import { Image } from 'react-native';

import { API_BASE_URL, getAuthToken } from '../api';

/**
 * Image that authenticates like every other API call.
 *
 * Nexlink serves avatars and attachments only to authenticated users, and
 * React Native's <Image> cannot attach an Authorization header — so without
 * this component every protected picture 401s and the UI shows the fallback.
 * The token is appended as ?token=<key>, which the backend's file-streaming
 * GET endpoints accept (same scheme as the WebSocket layer).
 *
 * The backend also returns *relative* media paths (e.g. /accounts/users/3/avatar/),
 * which only work in browsers where they resolve against the origin — RN needs
 * the absolute URL, so it is resolved against the API base URL here.
 */
export function AuthenticatedImage({ uri, token = getAuthToken(), ...props }) {
  const [source, setSource] = useState(null);

  useEffect(() => {
    if (!uri) {
      setSource(null);
      return;
    }
    let resolved = uri;
    if (resolved.startsWith('/')) {
      resolved = `${API_BASE_URL}${resolved}`;
    }
    if (!token || /(^|[?&])token=/.test(resolved)) {
      setSource({ uri: resolved });
      return;
    }
    const separator = resolved.includes('?') ? '&' : '?';
    setSource({ uri: `${resolved}${separator}token=${encodeURIComponent(token)}` });
  }, [uri, token]);

  if (!source) return null;
  return <Image source={source} {...props} />;
}
