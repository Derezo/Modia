const FALLBACKS = {
  heartlands: ['#9ec5a1', '#3d7f86', '#173f50'],
  sylvan_reaches: ['#4d8065', '#236b69', '#102f3d'],
  iron_depths: ['#554d6d', '#286071', '#101c2b'],
  shadowmere: ['#343352', '#263c50', '#101724'],
  bloodplains: ['#b27655', '#6f4b4a', '#263442'],
  common_waters: ['#729aaa', '#397287', '#173f50']
};

const ROD_SPRITES = Object.freeze({
  weathered: 'fishing_rod_weathered',
  weathered_rod: 'fishing_rod_weathered',
  riverwood: 'fishing_rod_riverwood',
  riverwood_rod: 'fishing_rod_riverwood',
  silverline: 'fishing_rod_silverline',
  silverline_rod: 'fishing_rod_silverline',
  runebound: 'fishing_rod_runebound',
  runebound_rod: 'fishing_rod_runebound'
});

const APPROVED_ROD_SPRITES = new Set(Object.values(ROD_SPRITES));

// Tip positions are calibrated against each accepted 512×512 transparent
// original. The artwork shifts by a few source pixels per rod so every visible
// tip lands on the same gameplay anchor instead of making the line float beside
// thicker or more ornate rod silhouettes.
const ROD_SOURCE_TIPS = Object.freeze({
  fishing_rod_weathered: Object.freeze({ x: 473 / 512, y: 42 / 512 }),
  fishing_rod_riverwood: Object.freeze({ x: 468.5 / 512, y: 36.5 / 512 }),
  fishing_rod_silverline: Object.freeze({ x: 466.5 / 512, y: 42.5 / 512 }),
  fishing_rod_runebound: Object.freeze({ x: 469.5 / 512, y: 41.5 / 512 })
});

const ROD_LAYOUT = Object.freeze({
  size: 0.62,
  targetTipX: 0.37,
  targetTipY: 0.22,
  leftShift: 0.15
});

function biomeKey(biome) {
  const value = typeof biome === 'string'
    ? biome
    : biome?.key || biome?.regionRace || biome?.name || '';
  return String(value).trim().toLowerCase().replaceAll(' ', '_');
}

function rodSpriteId(rod) {
  if (!rod || typeof rod !== 'object') return null;
  const explicitSprite = String(rod.spriteId || rod.sprite_id || '').trim().toLowerCase();
  if (APPROVED_ROD_SPRITES.has(explicitSprite)) return explicitSprite;

  const rawKey = String(
    rod.catalogKey || rod.catalog_key || rod.key || rod.id || ''
  ).trim().toLowerCase();
  const key = rawKey.startsWith('fishing:rod:')
    ? rawKey.slice('fishing:rod:'.length)
    : rawKey;
  return ROD_SPRITES[key] || null;
}

function rodPath(rod) {
  const spriteId = rodSpriteId(rod);
  return spriteId
    ? `/assets/items/originals/consumables/${spriteId}.webp`
    : null;
}

function clampUnit(value) {
  return Math.min(1, Math.max(0, value));
}

export class FishingRenderer {
  constructor({ reducedMotion = false, now = () => Date.now() } = {}) {
    this.reducedMotion = reducedMotion;
    this.now = now;
    this.state = null;
    this.backgroundPath = null;
    this.backgroundImage = null;
    this.backgroundReady = false;
    this.rodPath = null;
    this.rodImages = new Map();
    this.successUntil = 0;
    this.bigCatchEffect = false;
    this.destroyed = false;
  }

  setState(state) {
    this.state = state;
    if (state?.backgroundPath !== this.backgroundPath) {
      this.setBackground(state?.backgroundPath);
    }
    const nextRodPath = rodPath(state?.selectedRod);
    if (nextRodPath !== this.rodPath) {
      this.setRod(nextRodPath);
    }
  }

  setBackground(path) {
    this.backgroundPath = path || null;
    this.backgroundReady = false;
    this.backgroundImage = null;
    if (!path || typeof Image === 'undefined') return;

    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (!this.destroyed && this.backgroundImage === image) {
        this.backgroundReady = true;
      }
    };
    image.onerror = () => {
      if (this.backgroundImage === image) this.backgroundReady = false;
    };
    image.src = path;
    this.backgroundImage = image;
  }

  setRod(path) {
    this.rodPath = path;
    if (!path || typeof Image === 'undefined' || this.rodImages.has(path)) return;

    const image = new Image();
    const record = { image, ready: false };
    image.decoding = 'async';
    image.onload = () => {
      if (!this.destroyed && this.rodImages.get(path) === record) {
        record.ready = true;
      }
    };
    image.onerror = () => {
      if (this.rodImages.get(path) === record) record.ready = false;
    };
    image.src = path;
    this.rodImages.set(path, record);
  }

  triggerSuccess(isBigCatch = false) {
    this.successUntil = this.now() + (this.reducedMotion ? 250 : 1200);
    this.bigCatchEffect = isBigCatch;
  }

  destroy() {
    this.destroyed = true;
    if (this.backgroundImage) {
      this.backgroundImage.onload = null;
      this.backgroundImage.onerror = null;
    }
    for (const { image } of this.rodImages.values()) {
      image.onload = null;
      image.onerror = null;
    }
    this.backgroundImage = null;
    this.rodImages.clear();
    this.rodPath = null;
    this.state = null;
  }

  drawBackground(ctx, width, height) {
    if (this.backgroundReady && this.backgroundImage) {
      const image = this.backgroundImage;
      const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      ctx.drawImage(
        image,
        (width - drawWidth) / 2,
        (height - drawHeight) / 2,
        drawWidth,
        drawHeight
      );
      return;
    }

    const colors = FALLBACKS[biomeKey(this.state?.biome)] || FALLBACKS.common_waters;
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, colors[0]);
    gradient.addColorStop(0.55, colors[1]);
    gradient.addColorStop(1, colors[2]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  rodGeometry(width, height) {
    const size = Math.min(width, height) * ROD_LAYOUT.size;
    const tip = {
      x: (width * ROD_LAYOUT.targetTipX) - (size * ROD_LAYOUT.leftShift),
      y: height * ROD_LAYOUT.targetTipY
    };
    const sourceTip = ROD_SOURCE_TIPS[
      rodSpriteId(this.state?.selectedRod)
    ] || ROD_SOURCE_TIPS.fishing_rod_weathered;
    return {
      x: tip.x - (size * sourceTip.x),
      y: tip.y - (size * sourceTip.y),
      width: size,
      height: size,
      tip,
      sourceTip
    };
  }

  drawRodFallback(ctx, geometry, width, height) {
    const baseX = width * -0.06;
    const baseY = height * 0.42;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(24, 17, 12, 0.78)';
    ctx.lineWidth = Math.max(9, width * 0.014);
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.quadraticCurveTo(width * 0.08, height * 0.29, geometry.tip.x, geometry.tip.y);
    ctx.stroke();
    ctx.strokeStyle = '#8d5b35';
    ctx.lineWidth = Math.max(5, width * 0.008);
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.quadraticCurveTo(width * 0.08, height * 0.29, geometry.tip.x, geometry.tip.y);
    ctx.stroke();

    ctx.fillStyle = '#51402f';
    ctx.beginPath();
    ctx.arc(width * 0.015, height * 0.36, Math.max(8, width * 0.012), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d0b27d';
    ctx.lineWidth = Math.max(2, width * 0.003);
    ctx.stroke();
  }

  drawRod(ctx, width, height) {
    const geometry = this.rodGeometry(width, height);
    const record = this.rodPath ? this.rodImages.get(this.rodPath) : null;
    if (record?.ready) {
      ctx.drawImage(
        record.image,
        geometry.x,
        geometry.y,
        geometry.width,
        geometry.height
      );
    } else {
      this.drawRodFallback(ctx, geometry, width, height);
    }
    return geometry.tip;
  }

  bobberGeometry({
    x,
    y,
    phase,
    now,
    animate
  }) {
    const biteWave = phase === 'bite' && animate ? Math.sin(now / 90) : 0;
    const biteDip = phase === 'bite' ? 5 + (biteWave * 3) : 0;
    const centerY = y + biteDip;
    const radius = 10;
    const stemTop = centerY - 20;
    const eyeletY = stemTop - 3;
    return {
      x,
      phase,
      now,
      animate,
      biteWave,
      centerY,
      radius,
      stemTop,
      eyelet: { x, y: eyeletY }
    };
  }

  drawBobber(ctx, {
    x,
    phase,
    now,
    animate,
    biteWave,
    centerY,
    radius,
    stemTop,
    eyelet
  }) {
    const rippleProgress = animate ? (now % 700) / 700 : 0.35;
    const rippleStrength = phase === 'bite' ? 1.35 : 1;

    if (phase !== 'cast') {
      ctx.strokeStyle = phase === 'bite'
        ? 'rgba(250, 198, 76, 0.92)'
        : 'rgba(220, 241, 235, 0.58)';
      ctx.lineWidth = phase === 'bite' ? 2.5 : 1.4;
      const rippleCount = phase === 'bite' ? 2 : 1;
      for (let index = 0; index < rippleCount; index += 1) {
        const progress = animate
          ? (rippleProgress + (index * 0.45)) % 1
          : 0.42 + (index * 0.28);
        ctx.beginPath();
        ctx.ellipse(
          x,
          centerY + 8,
          (14 + progress * 19) * rippleStrength,
          (4 + progress * 5) * rippleStrength,
          0,
          0,
          Math.PI * 2
        );
        ctx.stroke();
      }

      ctx.fillStyle = 'rgba(239, 247, 235, 0.25)';
      ctx.beginPath();
      ctx.ellipse(x + 2, centerY + 10, 15, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = '#30251f';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x, centerY - radius + 1);
    ctx.lineTo(x, stemTop);
    ctx.stroke();

    ctx.fillStyle = '#f7edd7';
    ctx.beginPath();
    ctx.arc(x, centerY, radius, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = '#b43f35';
    ctx.beginPath();
    ctx.arc(x, centerY, radius, Math.PI, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#30251f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#d8aa70';
    ctx.fillRect(x - radius + 1, centerY - 2, (radius * 2) - 2, 4);
    ctx.strokeStyle = '#704b32';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - radius + 1, centerY - 2);
    ctx.lineTo(x + radius - 1, centerY - 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.beginPath();
    ctx.arc(x - 3.5, centerY - 4.5, 2.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f2dfb9';
    ctx.strokeStyle = '#30251f';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(eyelet.x, eyelet.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (phase === 'bite') {
      const pulseRadius = animate ? 16 + ((biteWave + 1) * 3) : 18;
      ctx.strokeStyle = 'rgba(250, 198, 76, 0.72)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, centerY, pulseRadius, 0, Math.PI * 2);
      ctx.stroke();
    }

  }

  render(ctx, width = 800, height = 600) {
    if (this.destroyed || !ctx) return;
    const now = this.now();
    const phase = this.state?.phase || 'idle';
    const castStart = (
      this.state?.attempt?.timestamps?.castStartedAt ??
      this.state?.castVisualStartedAt
    );
    const castNow = this.state?.serverNow ?? now;
    const animate = !this.reducedMotion;
    const shake = (
      animate &&
      this.bigCatchEffect &&
      now < this.successUntil
    ) ? Math.sin(now / 28) * 3 : 0;

    ctx.save();
    ctx.translate(shake, 0);
    this.drawBackground(ctx, width, height);

    const waterTop = height * 0.42;
    const shimmer = animate ? Math.sin(now / 700) * 0.04 : 0;
    const water = ctx.createLinearGradient(0, waterTop, 0, height);
    water.addColorStop(0, `rgba(144, 213, 220, ${0.20 + shimmer})`);
    water.addColorStop(1, 'rgba(18, 64, 83, 0.38)');
    ctx.fillStyle = water;
    ctx.fillRect(0, waterTop, width, height - waterTop);

    ctx.strokeStyle = 'rgba(231, 245, 232, 0.24)';
    ctx.lineWidth = 2;
    const waveOffset = animate ? (now / 35) % 80 : 0;
    for (let y = waterTop + 36; y < height; y += 42) {
      ctx.beginPath();
      for (let x = -80; x <= width + 80; x += 20) {
        const waveY = y + Math.sin((x + waveOffset) / 38) * 3;
        if (x === -80) ctx.moveTo(x, waveY);
        else ctx.lineTo(x, waveY);
      }
      ctx.stroke();
    }

    const rodTip = this.state?.selectedRod
      ? this.drawRod(ctx, width, height)
      : null;
    const castElapsed = castStart ? Math.max(0, castNow - castStart) : 0;
    const liveCastPower = clampUnit(castElapsed / 1600);
    const storedCastPowerValue = this.state?.attempt?.castPower;
    const storedCastPower = Number(storedCastPowerValue);
    const hasStoredCastPower = (
      storedCastPowerValue !== null &&
      storedCastPowerValue !== undefined &&
      Number.isFinite(storedCastPower)
    );
    const castPower = phase === 'cast' && !hasStoredCastPower
      ? liveCastPower
      : clampUnit(hasStoredCastPower ? storedCastPower / 100 : 0);
    const bobberX = width * (0.46 + castPower * 0.26);
    const bobberY = height * (0.63 - (phase === 'cast' ? Math.sin(castPower * Math.PI) * 0.20 : 0));
    if (phase !== 'idle' && phase !== 'resolved') {
      const bobber = this.bobberGeometry({
        x: bobberX,
        y: bobberY,
        phase,
        now,
        animate
      });
      ctx.strokeStyle = 'rgba(242, 234, 204, 0.88)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(rodTip?.x ?? width * 0.18, rodTip?.y ?? height * 0.12);
      ctx.quadraticCurveTo(
        width * 0.56,
        height * 0.18,
        bobber.eyelet.x,
        bobber.eyelet.y
      );
      ctx.stroke();

      this.drawBobber(ctx, bobber);
    }

    if (phase === 'wait' || phase === 'bite' || phase === 'reel') {
      ctx.fillStyle = 'rgba(10, 37, 49, 0.22)';
      const shadowX = bobberX - 80 + (animate ? Math.sin(now / 950) * 25 : 0);
      ctx.beginPath();
      ctx.ellipse(shadowX, height * 0.78, phase === 'reel' ? 62 : 40, 12, -0.14, 0, Math.PI * 2);
      ctx.fill();
    }

    if (phase === 'reel') {
      const cue = this.state?.attempt?.cues?.[
        this.state?.attempt?.nextCueIndex ?? this.state?.attempt?.cueIndex ?? 0
      ];
      if (cue) {
        ctx.fillStyle = 'rgba(245, 225, 157, 0.22)';
        ctx.fillRect(0, 0, width, height);
      }
    }

    if (now < this.successUntil) {
      if (this.reducedMotion) {
        ctx.fillStyle = 'rgba(255, 238, 157, 0.22)';
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = '#f8ecd0';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(
          width * 0.60,
          height * 0.62,
          44,
          15,
          -0.25,
          0,
          Math.PI * 2
        );
        ctx.stroke();
      } else {
        const progress = 1 - ((this.successUntil - now) / 1200);
        ctx.fillStyle = `rgba(255, 238, 157, ${Math.max(0, 0.30 * (1 - progress))})`;
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#f8ecd0';
        ctx.beginPath();
        ctx.ellipse(
          width * 0.60,
          height * (0.62 - Math.sin(Math.min(1, progress) * Math.PI) * 0.20),
          38,
          12,
          -0.25,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
