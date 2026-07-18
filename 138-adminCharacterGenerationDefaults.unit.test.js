import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveSd15CandidateDefaults } from '../../routes/admin/characterGenerationDefaults.js';

test('SD1.5 candidate defaults resolve from the nested staged-candidate manifest block', () => {
  const manifest = {
    generationDefaults: {
      mode: 'deterministic_compilers',
      stagedCandidate: {
        diffusion: {
          sd15: {
            controlnetWeight: 0.82,
            ipadapterWeight: 0.45,
            referenceLoraModel: 'cps2-pixel-art'
          }
        }
      }
    }
  };

  assert.deepEqual(resolveSd15CandidateDefaults(manifest), {
    controlnetWeight: 0.82,
    ipadapterWeight: 0.45,
    referenceLoraModel: 'cps2-pixel-art'
  });
});

test('nested SD1.5 candidate values win per field while legacy defaults fill omissions', () => {
  const legacyDefaults = {
    controlnetWeight: 0.6,
    ipadapterWeight: 0.7,
    loraModel: 'pixel-art-xl'
  };
  const stagedDefaults = {
    controlnetWeight: 0.8,
    animationLoraModel: 'cps2-pixel-art'
  };
  const manifest = {
    generationDefaults: {
      sd15: legacyDefaults,
      stagedCandidate: { diffusion: { sd15: stagedDefaults } }
    }
  };

  assert.deepEqual(resolveSd15CandidateDefaults(manifest), {
    controlnetWeight: 0.8,
    ipadapterWeight: 0.7,
    loraModel: 'pixel-art-xl',
    animationLoraModel: 'cps2-pixel-art'
  });
  assert.deepEqual(legacyDefaults, {
    controlnetWeight: 0.6,
    ipadapterWeight: 0.7,
    loraModel: 'pixel-art-xl'
  });
  assert.deepEqual(stagedDefaults, {
    controlnetWeight: 0.8,
    animationLoraModel: 'cps2-pixel-art'
  });
});

test('legacy-only and missing manifests remain backward compatible', () => {
  assert.deepEqual(resolveSd15CandidateDefaults({
    generationDefaults: {
      sd15: { controlnetWeight: 0.7, ipadapterWeight: 0.65 }
    }
  }), {
    controlnetWeight: 0.7,
    ipadapterWeight: 0.65
  });
  assert.deepEqual(resolveSd15CandidateDefaults(), {});
  assert.deepEqual(resolveSd15CandidateDefaults({ generationDefaults: null }), {});
});
