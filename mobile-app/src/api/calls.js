import { request } from './client';

export function getCallHistory() {
  return request('/api/calls/');
}

export function startCall(conversationId, kind = 'voice') {
  return request(`/api/conversations/${conversationId}/calls/`, {
    method: 'POST',
    body: JSON.stringify({ kind }),
  });
}

export function answerCall(callId) {
  return request(`/api/calls/${callId}/answer/`, { method: 'POST' });
}

export function declineCall(callId) {
  return request(`/api/calls/${callId}/decline/`, { method: 'POST' });
}

export function endCall(callId) {
  return request(`/api/calls/${callId}/end/`, { method: 'POST' });
}

export function signalCall(callId, signalType, payload) {
  return request(`/api/calls/${callId}/signal/`, {
    method: 'POST',
    body: JSON.stringify({ signal_type: signalType, payload }),
  });
}
