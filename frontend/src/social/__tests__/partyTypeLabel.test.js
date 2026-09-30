import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatPartyType } from '../partyTypeLabel.js';

describe('formatPartyType', () => {
  it('labels every party_type enum value', () => {
    assert.equal(formatPartyType('adventure'), 'Adventure');
    assert.equal(formatPartyType('coliseum_team'), 'Coliseum Team');
    assert.equal(formatPartyType('raid'), 'Raid');
  });

  it('never renders a raw or unknown value', () => {
    assert.equal(formatPartyType(undefined), 'Party');
    assert.equal(formatPartyType('<img src=x>'), 'Party');
  });
});
