/** Normalize thrown errors into user-friendly text (no raw "Network request failed"). */
export function friendlyError(error) {
  const message = String(error?.message || error || 'Something went wrong.');
  if (/network request failed/i.test(message)) {
    return 'Unable to connect to Nexlink. Please check your internet connection or try again.';
  }
  return message;
}

export function isOfflineError(message) {
  return /internet|reach|connect|offline|respond/i.test(String(message || ''));
}
