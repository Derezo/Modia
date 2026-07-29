'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const {
  resolveGenerationMode,
  resolveCharacterGenerationConfig,
  prepareAnimationReference,
  resolveAnimationGuidance
} = require('./generate-characters');
const characterManifest = require('../../ai-image-metadata/characters/manifest.json');

const manifest = {
  generationDefaults: {
    sd15: {
      controlnetWeight: 0.7,
      ipadapterWeight: 0.65,
      loraModel: 'pixel-art-xl'
    }
  }
};

test('portrait-matched variants default to SD1.5 while legacy characters remain on Flux', () => {
  assert.equal(
    resolveGenerationMode({ id: 'human_male_warrior', _type: 'player', _variant: true }),
    'sd15'
  );
  assert.equal(
    resolveGenerationMode({ id: 'warrior', _type: 'player', _variant: false }),
    'flux'
  );
  assert.equal(
    resolveGenerationMode({ id: 'goblin', _type: 'enemy' }),
    'flux'
  );
});

test('explicit mode overrides automatic per-character mode selection', () => {
  const variant = { id: 'human_male_warrior', _type: 'player', _variant: true };
  const enemy = { id: 'goblin', _type: 'enemy' };

  assert.equal(resolveGenerationMode(variant, 'flux'), 'flux');
  assert.equal(resolveGenerationMode(enemy, 'sd15'), 'sd15');
  assert.throws(
    () => resolveGenerationMode(variant, 'automatic'),
    /Invalid generation mode 'automatic'/
  );
});

test('SD1.5 settings resolve from character metadata before manifest defaults', () => {
  const variant = {
    id: 'human_male_warrior',
    _type: 'player',
    _variant: true,
    sd15Config: {
      ipadapterWeight: 0.82,
      referenceLoraModel: null,
      animationLoraModel: '16-bit-pixel'
    }
  };

  assert.deepEqual(resolveCharacterGenerationConfig(variant, {}, manifest), {
    mode: 'sd15',
    controlnetWeight: 0.7,
    ipadapterWeight: 0.82,
    referenceLoraModel: 'pixel-art-xl',
    animationLoraModel: '16-bit-pixel'
  });
});

test('staged-candidate SD1.5 settings supersede the backward-compatible legacy manifest block', () => {
  const variant = {
    id: 'elf_female_wizard',
    _type: 'player',
    _variant: true,
    sd15Config: {}
  };
  const candidateManifest = {
    generationDefaults: {
      sd15: {
        controlnetWeight: 0.4,
        ipadapterWeight: 0.4,
        loraModel: 'pixel-art-xl'
      },
      stagedCandidate: {
        diffusion: {
          sd15: {
            controlnetWeight: 0.82,
            ipadapterWeight: 0.45,
            referenceLoraModel: 'cps2-pixel-art',
            animationLoraModel: '16-bit-pixel'
          }
        }
      }
    }
  };

  assert.deepEqual(resolveCharacterGenerationConfig(variant, {}, candidateManifest), {
    mode: 'sd15',
    controlnetWeight: 0.82,
    ipadapterWeight: 0.45,
    referenceLoraModel: 'cps2-pixel-art',
    animationLoraModel: '16-bit-pixel'
  });
});

test('repository character manifest resolves optional staged-candidate diffusion defaults', () => {
  const variant = {
    id: 'human_other_medic',
    _type: 'player',
    _variant: true,
    sd15Config: {}
  };

  assert.equal(
    characterManifest.generationDefaults.mode,
    'deterministic_compilers_with_reviewed_authored_sources'
  );
  assert.equal(characterManifest.generationDefaults.stagedCandidate.optional, true);
  assert.deepEqual(resolveCharacterGenerationConfig(variant, {}, characterManifest), {
    mode: 'sd15',
    controlnetWeight: 0.7,
    ipadapterWeight: 0.7,
    referenceLoraModel: 'cps2-pixel-art',
    animationLoraModel: 'cps2-pixel-art'
  });
});

test('explicit SD1.5 CLI overrides win over character and manifest settings', () => {
  const variant = {
    id: 'human_male_warrior',
    _type: 'player',
    _variant: true,
    sd15Config: {
      controlnetWeight: 0.6,
      ipadapterWeight: 0.8,
      referenceLoraModel: 'pixel-art-xl',
      animationLoraModel: '16-bit-pixel'
    }
  };

  assert.deepEqual(resolveCharacterGenerationConfig(variant, {
    mode: 'sd15',
    controlnetWeight: 0.91,
    ipadapterWeight: 0.42,
    lora: 'cps2-pixel-art'
  }, manifest), {
    mode: 'sd15',
    controlnetWeight: 0.91,
    ipadapterWeight: 0.42,
    referenceLoraModel: 'cps2-pixel-art',
    animationLoraModel: 'cps2-pixel-art'
  });
});

test('legacy Flux configuration keeps its character LoRA', () => {
  const legacyPlayer = {
    id: 'warrior',
    _type: 'player',
    _variant: false,
    loraModel: 'retro-pixel'
  };

  assert.deepEqual(resolveCharacterGenerationConfig(legacyPlayer, {}, manifest), {
    mode: 'flux',
    loraModel: 'retro-pixel'
  });
});

test('model-family mismatches fail before generation', () => {
  const variant = {
    id: 'human_male_warrior',
    _type: 'player',
    _variant: true,
    sd15Config: {}
  };

  assert.throws(
    () => resolveCharacterGenerationConfig(variant, { lora: 'v1' }, manifest),
    /SD1\.5 reference LoRA 'v1'.*incompatible/
  );
  assert.throws(
    () => resolveCharacterGenerationConfig(
      { ...variant, loraModel: 'v1' },
      { mode: 'flux', lora: 'pixel-art-xl' },
      manifest
    ),
    /Flux animation LoRA 'pixel-art-xl'.*incompatible/
  );
});

test('invalid guidance metadata fails clearly', () => {
  const variant = {
    id: 'human_male_warrior',
    _type: 'player',
    _variant: true,
    sd15Config: { ipadapterWeight: 1.2 }
  };

  assert.throws(
    () => resolveCharacterGenerationConfig(variant, {}, manifest),
    /IP-Adapter weight.*between 0 and 1/
  );
});

test('transparent identity references are flattened onto a white IP-Adapter stage', async () => {
  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'modia-reference-'));
  try {
    const referencePath = path.join(fixtureDirectory, 'reference.png');
    const preparedDirectory = path.join(fixtureDirectory, 'prepared');
    await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 4,
        background: { r: 12, g: 34, b: 56, alpha: 0 }
      }
    }).png().toFile(referencePath);

    const preparedPath = await prepareAnimationReference(
      referencePath,
      { id: 'human_male_warrior' },
      { outputDirectory: preparedDirectory }
    );
    const metadata = await sharp(preparedPath).metadata();
    const pixel = await sharp(preparedPath).raw().toBuffer();

    assert.equal(metadata.hasAlpha, false);
    assert.deepEqual([...pixel.subarray(0, 3)], [255, 255, 255]);
    assert.equal(path.basename(preparedPath), 'human_male_warrior_ipadapter_v3.png');
  } finally {
    await fs.rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test('portrait-only references use pose-dominant guidance while full-body references stay balanced', () => {
  assert.deepEqual(
    resolveAnimationGuidance('/assets/portraits/originals/elf_female_wizard.png', {
      controlnetWeight: 0.7,
      ipadapterWeight: 0.7
    }),
    { controlnetWeight: 0.82, ipadapterWeight: 0.45, mode: 'portrait_pose_dominant' }
  );
  assert.deepEqual(
    resolveAnimationGuidance('/assets/characters/player/human/male/warrior/reference.png', {
      controlnetWeight: 0.7,
      ipadapterWeight: 0.7
    }),
    { controlnetWeight: 0.7, ipadapterWeight: 0.7, mode: 'full_body_reference' }
  );
});
