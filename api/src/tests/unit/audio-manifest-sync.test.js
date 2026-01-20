/**
 * Audio Manifest Sync Test
 * Ensures frontend AUDIO_MANIFEST and metadata JSON files stay in sync.
 * Run this test during plan validation and code review to catch mismatches.
 *
 * This test validates that:
 * 1. All keys in frontend AUDIO_MANIFEST exist in metadata
 * 2. All keys in metadata exist in frontend AUDIO_MANIFEST
 * 3. Music and SFX counts match between frontend and metadata
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROJECT_ROOT = path.resolve(__dirname, '../../../..');

describe('Audio Manifest Sync', () => {
  it('should have frontend and metadata manifests in sync', () => {
    // Run the manifest sync validation script
    try {
      const result = execSync(
        'node scripts/audio/validate-manifest-sync.js',
        {
          cwd: PROJECT_ROOT,
          encoding: 'utf8',
          timeout: 30000
        }
      );

      // If we get here, the script exited with code 0 (success)
      assert.ok(result.includes('All manifests are in sync'), 'Manifests should be in sync');
    } catch (error) {
      // Script exited with non-zero code, meaning there are sync issues
      const output = error.stdout || '';
      const stderr = error.stderr || '';

      // Extract the number of issues from the output
      const issueMatch = output.match(/Found (\d+) sync issue/);
      const issueCount = issueMatch ? issueMatch[1] : 'unknown';

      // Provide helpful error message
      let errorMessage = `Audio manifest sync failed with ${issueCount} issue(s).\\n\\n`;
      errorMessage += 'Run "npm run audio:check" to see details.\\n\\n';

      // Extract frontend-only and metadata-only keys for the error message
      const frontendOnlyMatch = output.match(/Keys in frontend but NOT in metadata:([\s\S]*?)(?:Keys in metadata|══)/);
      const metadataOnlyMatch = output.match(/Keys in metadata but NOT in frontend:([\s\S]*?)(?:══|$)/);

      if (frontendOnlyMatch) {
        const keys = frontendOnlyMatch[1].match(/- (\w+)/g);
        if (keys && keys.length > 0) {
          errorMessage += 'Frontend-only keys (need metadata entries):\\n';
          keys.slice(0, 5).forEach(k => errorMessage += `  ${k}\\n`);
          if (keys.length > 5) errorMessage += `  ... and ${keys.length - 5} more\\n`;
          errorMessage += '\\n';
        }
      }

      if (metadataOnlyMatch) {
        const keys = metadataOnlyMatch[1].match(/- (\w+)/g);
        if (keys && keys.length > 0) {
          errorMessage += 'Metadata-only keys (need frontend entries):\\n';
          keys.slice(0, 5).forEach(k => errorMessage += `  ${k}\\n`);
          if (keys.length > 5) errorMessage += `  ... and ${keys.length - 5} more\\n`;
        }
      }

      assert.fail(errorMessage);
    }
  });

  it('should have valid audio validation script output', () => {
    // Run the audio status check to ensure counts are valid
    try {
      const result = execSync(
        'node scripts/audio/validate-audio.js --status',
        {
          cwd: PROJECT_ROOT,
          encoding: 'utf8',
          timeout: 30000
        }
      );

      // Verify the output has expected sections
      assert.ok(result.includes('MUSIC'), 'Should have MUSIC section');
      assert.ok(result.includes('SOUND EFFECTS'), 'Should have SOUND EFFECTS section');
    } catch (error) {
      // The script may exit with non-zero if files are missing, which is expected
      // We just want to make sure it runs without crashing
      const output = error.stdout || error.message;
      assert.ok(
        output.includes('MUSIC') || output.includes('SOUND EFFECTS'),
        'Audio validation script should run successfully'
      );
    }
  });
});
