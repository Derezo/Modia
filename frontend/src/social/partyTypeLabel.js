/**
 * Player-facing labels for the multiplayer party_type enum
 * (adventure | coliseum_team | raid, see api/src/routes/party.js).
 */
const PARTY_TYPE_LABELS = {
  adventure: 'Adventure',
  coliseum_team: 'Coliseum Team',
  raid: 'Raid'
};

/**
 * @param {string|null|undefined} partyType - Raw enum value from the API
 * @returns {string} Readable label; unknown values fall back to 'Party'
 */
export function formatPartyType(partyType) {
  return PARTY_TYPE_LABELS[partyType] ?? 'Party';
}
