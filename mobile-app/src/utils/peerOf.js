/** The other participant of a 1:1 conversation (null for groups). */
export function peerOf(conversation, currentUser) {
  if (!conversation || conversation.kind === 'group') return null;
  return conversation.participants?.find((person) => person.id !== currentUser?.id) || null;
}
