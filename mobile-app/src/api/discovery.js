import { request } from './client';

/**
 * Contact discovery API — same endpoints as the web client.
 * POST /api/contacts/match/ never stores identifiers server-side; the
 * response only contains matched Nexlink users with safe public fields.
 */
export function matchContacts(phones = [], emails = [], source = 'phone_contacts') {
  return request('/api/contacts/match/', {
    method: 'POST',
    body: JSON.stringify({ phones, emails, source }),
  });
}

export function getPeopleSuggestions(limit = 20) {
  return request(`/api/contacts/suggestions/?limit=${limit}`);
}

/**
 * Read + normalize device contacts locally, then match against Nexlink.
 * Returns { results, rejected, submitted } where `submitted` is how many
 * identifiers were sent. Nothing is persisted on the server.
 */
export async function discoverContacts({ source = 'phone_contacts' } = {}) {
  let Contacts = null;
  try {
    Contacts = require('expo-contacts');
  } catch {
    return { results: [], rejected: 0, submitted: 0, error: 'unavailable' };
  }

  const { status } = await Contacts.requestPermissionsAsync();
  if (status !== 'granted') {
    return { results: [], rejected: 0, submitted: 0, error: 'denied' };
  }

  const page = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
    pageSize: 2000,
    pageOffset: 0,
  });
  const contacts = page?.data || [];

  const phones = new Set();
  const emails = new Set();
  for (const contact of contacts) {
    (contact.phoneNumbers || []).forEach((entry) => entry.number && phones.add(entry.number.trim()));
    (contact.emails || []).forEach((entry) => entry.email && emails.add(entry.email.trim().toLowerCase()));
  }

  // Payload cap mirrors the server limit (200 phones / 200 emails).
  const phoneList = [...phones].slice(0, 200);
  const emailList = [...emails].slice(0, 200);
  if (!phoneList.length && !emailList.length) {
    return { results: [], rejected: 0, submitted: 0 };
  }

  try {
    const data = await matchContacts(phoneList, emailList, source);
    return {
      results: data?.results || [],
      rejected: data?.rejected || 0,
      submitted: phoneList.length + emailList.length,
    };
  } catch (err) {
    return { results: [], rejected: 0, submitted: 0, error: err?.message || 'network' };
  }
}
