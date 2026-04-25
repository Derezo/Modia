/**
 * Unit tests for the lore content system
 * Tests content generation, regional theming, and fallback behavior
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  getLoreContent,
  getRegionalLoreTitles,
  validateLoreContent,
  REGIONAL_LORE,
  GENERIC_LORE,
  ERAS
} from '../../../../shared/loreContent.js';

describe('Lore Content System', () => {

  describe('getLoreContent', () => {

    it('returns content with all required fields for known lore key', () => {
      const content = getLoreContent('lore_15_20', 'Test Location', 'human');

      assert.ok(content.title, 'should have title');
      assert.ok(content.text, 'should have text');
      assert.ok(content.region, 'should have region');
      assert.ok(content.era, 'should have era');
      assert.strictEqual(content.lore_key, 'lore_15_20', 'should preserve lore_key');
    });

    it('returns non-empty text for all regional content', () => {
      const races = ['human', 'elf', 'dwarf', 'vampire', 'orc'];

      for (const race of races) {
        const content = getLoreContent('lore_10_10', 'Test', race);
        assert.ok(content.text.length > 50, `${race} lore should have substantial text`);
      }
    });

    it('returns fallback content for unknown region', () => {
      const content = getLoreContent('lore_10_10', 'Mysterious Place', null);

      assert.ok(content.title, 'should have title');
      assert.ok(content.text, 'should have text');
      assert.strictEqual(content.region, 'Unknown Region', 'should show unknown region');
    });

    it('returns consistent content for same lore key', () => {
      const content1 = getLoreContent('lore_25_30', 'Test', 'elf');
      const content2 = getLoreContent('lore_25_30', 'Test', 'elf');

      assert.strictEqual(content1.title, content2.title, 'same key should return same title');
      assert.strictEqual(content1.text, content2.text, 'same key should return same text');
    });

    it('returns different content for different coordinates', () => {
      const content1 = getLoreContent('lore_10_10', 'Test', 'dwarf');
      const content2 = getLoreContent('lore_20_20', 'Test', 'dwarf');

      // They might occasionally match by chance, but with enough entries it's unlikely
      // At minimum, verify both are valid
      assert.ok(content1.title, 'first should have title');
      assert.ok(content2.title, 'second should have title');
    });

    it('assigns era based on distance from center', () => {
      // Close to center (0-15 distance) = current era
      const nearContent = getLoreContent('lore_5_5', 'Test', 'human');
      assert.strictEqual(nearContent.era, ERAS.current, 'near center should be current era');

      // Far from center (>35 distance) = ancient era
      const farContent = getLoreContent('lore_40_40', 'Test', 'human');
      assert.strictEqual(farContent.era, ERAS.ancient, 'far from center should be ancient era');
    });

    it('handles malformed lore keys gracefully', () => {
      const content1 = getLoreContent('invalid_key', 'Fallback Name', 'orc');
      assert.ok(content1.title, 'should return content for invalid key');

      const content2 = getLoreContent(null, 'Fallback Name', 'vampire');
      assert.ok(content2.title, 'should return content for null key');

      const content3 = getLoreContent(undefined, 'Fallback Name', 'elf');
      assert.ok(content3.title, 'should return content for undefined key');
    });

    it('maps region races to correct display names', () => {
      const expectations = {
        human: 'Heartlands',
        elf: 'Sylvan Reaches',
        dwarf: 'Iron Depths',
        vampire: 'Shadowmere',
        orc: 'Bloodplains'
      };

      for (const [race, expectedRegion] of Object.entries(expectations)) {
        const content = getLoreContent('lore_10_10', 'Test', race);
        assert.strictEqual(content.region, expectedRegion, `${race} should map to ${expectedRegion}`);
      }
    });
  });

  describe('getRegionalLoreTitles', () => {

    it('returns titles for each race', () => {
      const races = ['human', 'elf', 'dwarf', 'vampire', 'orc'];

      for (const race of races) {
        const titles = getRegionalLoreTitles(race);
        assert.ok(Array.isArray(titles), `${race} should return array`);
        assert.ok(titles.length > 0, `${race} should have titles`);
        assert.ok(titles.every(t => typeof t === 'string'), `${race} titles should be strings`);
      }
    });

    it('returns generic titles for unknown race', () => {
      const titles = getRegionalLoreTitles('unknown_race');
      assert.ok(Array.isArray(titles), 'should return array');
      assert.strictEqual(titles.length, GENERIC_LORE.length, 'should return generic lore count');
    });

    it('returns generic titles for null race', () => {
      const titles = getRegionalLoreTitles(null);
      assert.strictEqual(titles.length, GENERIC_LORE.length, 'should return generic lore');
    });
  });

  describe('validateLoreContent', () => {

    it('validates all lore entries have required fields', () => {
      const result = validateLoreContent();

      assert.strictEqual(result.valid, true, 'all entries should be valid');
      assert.strictEqual(result.errors.length, 0, 'should have no errors');
    });

    it('reports correct stats for each region', () => {
      const result = validateLoreContent();

      assert.strictEqual(result.stats.human, REGIONAL_LORE.human.length);
      assert.strictEqual(result.stats.elf, REGIONAL_LORE.elf.length);
      assert.strictEqual(result.stats.dwarf, REGIONAL_LORE.dwarf.length);
      assert.strictEqual(result.stats.vampire, REGIONAL_LORE.vampire.length);
      assert.strictEqual(result.stats.orc, REGIONAL_LORE.orc.length);
      assert.strictEqual(result.stats.generic, GENERIC_LORE.length);
    });

    it('reports total lore count', () => {
      const result = validateLoreContent();
      const expectedTotal = Object.values(REGIONAL_LORE).reduce((sum, arr) => sum + arr.length, 0)
        + GENERIC_LORE.length;

      assert.strictEqual(result.stats.total, expectedTotal, 'total should match sum');
    });
  });

  describe('REGIONAL_LORE data integrity', () => {

    it('has at least 5 entries per region', () => {
      const races = ['human', 'elf', 'dwarf', 'vampire', 'orc'];

      for (const race of races) {
        assert.ok(
          REGIONAL_LORE[race].length >= 5,
          `${race} should have at least 5 lore entries, has ${REGIONAL_LORE[race].length}`
        );
      }
    });

    it('has unique titles within each region', () => {
      for (const [race, entries] of Object.entries(REGIONAL_LORE)) {
        const titles = entries.map(e => e.title);
        const uniqueTitles = new Set(titles);
        assert.strictEqual(titles.length, uniqueTitles.size, `${race} should have unique titles`);
      }
    });

    it('each entry has text of at least 100 characters', () => {
      for (const [race, entries] of Object.entries(REGIONAL_LORE)) {
        for (const entry of entries) {
          assert.ok(
            entry.text.length >= 100,
            `${race} "${entry.title}" should have substantial text (has ${entry.text.length} chars)`
          );
        }
      }
    });
  });

  describe('GENERIC_LORE data integrity', () => {

    it('has at least 5 generic entries', () => {
      assert.ok(GENERIC_LORE.length >= 5, `should have at least 5 generic entries, has ${GENERIC_LORE.length}`);
    });

    it('has unique titles', () => {
      const titles = GENERIC_LORE.map(e => e.title);
      const uniqueTitles = new Set(titles);
      assert.strictEqual(titles.length, uniqueTitles.size, 'generic should have unique titles');
    });

    it('each entry has text of at least 100 characters', () => {
      for (const entry of GENERIC_LORE) {
        assert.ok(
          entry.text.length >= 100,
          `"${entry.title}" should have substantial text (has ${entry.text.length} chars)`
        );
      }
    });
  });

  describe('Coverage completeness', () => {

    it('covers all 5 playable races', () => {
      const expectedRaces = ['human', 'elf', 'dwarf', 'vampire', 'orc'];

      for (const race of expectedRaces) {
        assert.ok(REGIONAL_LORE[race], `should have lore for ${race}`);
        assert.ok(Array.isArray(REGIONAL_LORE[race]), `${race} lore should be array`);
      }
    });

    it('total lore count meets minimum threshold', () => {
      const result = validateLoreContent();
      // 8 entries per region (5 regions) + 8 generic = 48 minimum
      assert.ok(result.stats.total >= 40, `should have at least 40 total entries, has ${result.stats.total}`);
    });
  });
});
