/**
 * MSW Request Handlers
 * Mock API responses for testing
 */

import { http, HttpResponse } from 'msw';

const API_BASE = '/api/admin';

// Default mock data
export const mockAssets = {
  tiles: [
    {
      id: 'forest_grass_1',
      category: 'tiles',
      subcategory: 'floors',
      biome: 'forest',
      status: 'exists',
      file: 'forest_grass_1.png',
      path: '/assets/sprites/terrain/forest/grass_1.png',
      needsRegeneration: false
    },
    {
      id: 'cave_rock_1',
      category: 'tiles',
      subcategory: 'floors',
      biome: 'cave',
      status: 'missing',
      file: null,
      path: '/assets/sprites/terrain/cave/rock_1.png',
      needsRegeneration: false
    }
  ],
  portraits: [
    {
      id: 'human_male_warrior',
      category: 'portraits',
      race: 'human',
      gender: 'male',
      class: 'warrior',
      status: 'exists',
      file: 'human_male_warrior.png',
      needsRegeneration: false
    }
  ],
  items: [],
  icons: [],
  nodes: []
};

export const mockAudioAssets = {
  music: [
    {
      id: 'heartlands_tavern',
      type: 'music',
      region: 'heartlands',
      subcategory: 'tavern',
      status: 'exists',
      path: '/assets/audio/music/regions/heartlands_tavern.mp3',
      needsRegeneration: false,
      variants: []
    }
  ],
  sfx: [
    {
      id: 'attack_sword_1',
      type: 'sfx',
      category: 'combat',
      subcategory: 'weapons',
      status: 'missing',
      path: '/assets/audio/sfx/combat/weapons/attack_sword_1.mp3',
      needsRegeneration: false
    }
  ]
};

export const mockQueue = {
  current: null,
  pending: [],
  paused: false,
  stats: {
    pendingCount: 0,
    historyCount: 5,
    isProcessing: false
  }
};

export const mockAudioQueue = {
  current: null,
  pending: [],
  paused: false
};

export const mockStats = {
  tiles: { total: 100, existing: 75, missing: 25 },
  portraits: { total: 50, existing: 40, missing: 10 },
  items: { total: 30, existing: 30, missing: 0 },
  icons: { total: 20, existing: 15, missing: 5 },
  nodes: { total: 10, existing: 10, missing: 0 }
};

export const mockAudioStats = {
  music: { total: 25, existing: 20, missing: 5 },
  sfx: { total: 100, existing: 80, missing: 20 }
};

export const mockConfig = {
  categories: ['tiles', 'portraits', 'items', 'icons', 'nodes'],
  audioTypes: ['music', 'sfx'],
  defaultModel: 'flux-pro',
  version: '1.0.0'
};

export const mockTheme = {
  primary: '#8B4513',
  secondary: '#D2691E',
  background: '#1a1a2e',
  surface: '#16213e',
  text: '#e4e4e4'
};

export const mockBackups = [
  {
    timestamp: '2025-01-25T10:00:00Z',
    reason: 'manual',
    size: 1024000,
    categories: ['tiles', 'portraits']
  },
  {
    timestamp: '2025-01-24T15:30:00Z',
    reason: 'pre-generation',
    size: 2048000,
    categories: ['tiles', 'portraits', 'items']
  }
];

export const mockRegenerationQueue = {
  tiles: [{ id: 'cave_rock_1', category: 'tiles', status: 'missing' }],
  portraits: [],
  items: [],
  icons: [],
  nodes: [],
  music: [],
  sfx: []
};

/**
 * Default handlers for all admin API endpoints
 */
export const handlers = [
  // Config
  http.get(`${API_BASE}/config`, () => {
    return HttpResponse.json(mockConfig);
  }),

  // Stats
  http.get(`${API_BASE}/stats`, () => {
    return HttpResponse.json(mockStats);
  }),

  // Status
  http.get(`${API_BASE}/status`, () => {
    return HttpResponse.json({
      enabled: true,
      environment: 'test',
      utilitiesLoaded: {
        metadata: true,
        backup: true,
      },
    });
  }),

  // Assets - List
  http.get(`${API_BASE}/assets/:category`, ({ params }) => {
    const { category } = params;
    const assets = mockAssets[category] || [];
    return HttpResponse.json({ assets, total: assets.length });
  }),

  // Assets - Get single
  http.get(`${API_BASE}/assets/:category/:id`, ({ params }) => {
    const { category, id } = params;
    const assets = mockAssets[category] || [];
    const asset = assets.find((a) => a.id === id);
    if (!asset) {
      return new HttpResponse(null, { status: 404 });
    }
    return HttpResponse.json(asset);
  }),

  // Assets - Update
  http.put(`${API_BASE}/assets/:category/:id`, async ({ params, request }) => {
    const { category, id } = params;
    const updates = await request.json();
    const assets = mockAssets[category] || [];
    const asset = assets.find((a) => a.id === id);
    if (!asset) {
      return new HttpResponse(null, { status: 404 });
    }
    Object.assign(asset, updates);
    return HttpResponse.json(asset);
  }),

  // Assets - Mark for regeneration
  http.put(`${API_BASE}/assets/:category/:id/mark-regeneration`, async ({ params, request }) => {
    const { category, id } = params;
    const { mark } = await request.json();
    const assets = mockAssets[category] || [];
    const asset = assets.find((a) => a.id === id);
    if (!asset) {
      return new HttpResponse(null, { status: 404 });
    }
    asset.needsRegeneration = mark;
    return HttpResponse.json({ success: true, asset });
  }),

  // Assets - Bulk mark
  http.put(`${API_BASE}/assets/mark-multiple`, async ({ request }) => {
    const { category, ids, mark } = await request.json();
    const assets = mockAssets[category] || [];
    let updated = 0;
    ids.forEach((id) => {
      const asset = assets.find((a) => a.id === id);
      if (asset) {
        asset.needsRegeneration = mark;
        updated++;
      }
    });
    return HttpResponse.json({ success: true, updated });
  }),

  // Assets - Bulk update metadata
  http.post(`${API_BASE}/assets/bulk-update`, async ({ request }) => {
    const { assetIds, category, updates } = await request.json();

    // Validation
    if (!assetIds || assetIds.length === 0) {
      return HttpResponse.json(
        { error: 'assetIds array cannot be empty' },
        { status: 400 }
      );
    }

    if (!category) {
      return HttpResponse.json(
        { error: 'category is required' },
        { status: 400 }
      );
    }

    if (!updates || Object.keys(updates).length === 0) {
      return HttpResponse.json(
        { error: 'updates object is required' },
        { status: 400 }
      );
    }

    // Validate loraModel if provided
    const validLoraModels = ['flux-pro', 'flux-realistic', 'flux-pixel', 'flux-anime'];
    if (updates.loraModel && !validLoraModels.includes(updates.loraModel)) {
      return HttpResponse.json(
        { error: `Invalid loraModel: ${updates.loraModel}` },
        { status: 400 }
      );
    }

    // Validate priority if provided
    if (updates.priority !== undefined) {
      const priority = parseInt(updates.priority, 10);
      if (isNaN(priority) || priority < 0 || priority > 100) {
        return HttpResponse.json(
          { error: 'Priority must be a number between 0 and 100' },
          { status: 400 }
        );
      }
    }

    // Simulate update
    const assets = mockAssets[category] || [];
    let updated = 0;
    const notFound = [];

    assetIds.forEach((id) => {
      const asset = assets.find((a) => a.id === id);
      if (asset) {
        Object.assign(asset, updates);
        updated++;
      } else {
        notFound.push(id);
      }
    });

    return HttpResponse.json({
      success: true,
      updated,
      notFound: notFound.length,
      errors: []
    });
  }),

  // Generation Queue
  http.get(`${API_BASE}/generate/queue`, () => {
    return HttpResponse.json(mockQueue);
  }),

  // Generate assets
  http.post(`${API_BASE}/generate`, async ({ request }) => {
    const body = await request.json();
    const job = {
      id: `job_${Date.now()}`,
      category: body.category,
      filters: body.filters,
      status: 'queued',
      createdAt: new Date().toISOString()
    };
    return HttpResponse.json({ success: true, job });
  }),

  // Cancel job
  http.post(`${API_BASE}/generate/cancel`, async ({ request }) => {
    const { jobId, all } = await request.json();
    return HttpResponse.json({
      success: true,
      cancelled: all ? 5 : 1,
      jobId
    });
  }),

  // Regeneration queue
  http.get(`${API_BASE}/regeneration-queue`, () => {
    return HttpResponse.json(mockRegenerationQueue);
  }),

  // Clear regeneration queue
  http.post(`${API_BASE}/regeneration-queue/clear`, async ({ request }) => {
    const { category } = await request.json();
    return HttpResponse.json({
      success: true,
      cleared: category ? 5 : 10
    });
  }),

  // Process regeneration queue
  http.post(`${API_BASE}/generate/regeneration-queue`, async ({ request }) => {
    const options = await request.json();
    return HttpResponse.json({
      success: true,
      job: {
        id: `regen_${Date.now()}`,
        category: options.category || 'all',
        status: 'queued'
      }
    });
  }),

  // Audio - List
  http.get(`${API_BASE}/audio/:audioType`, ({ params }) => {
    const { audioType } = params;
    const assets = mockAudioAssets[audioType] || [];
    return HttpResponse.json({ assets, total: assets.length });
  }),

  // Audio - Get single
  http.get(`${API_BASE}/audio/:audioType/:id`, ({ params }) => {
    const { audioType, id } = params;
    const assets = mockAudioAssets[audioType] || [];
    const asset = assets.find((a) => a.id === id);
    if (!asset) {
      return new HttpResponse(null, { status: 404 });
    }
    return HttpResponse.json(asset);
  }),

  // Audio - Update
  http.put(`${API_BASE}/audio/:audioType/:id`, async ({ params, request }) => {
    const { audioType, id } = params;
    const updates = await request.json();
    const assets = mockAudioAssets[audioType] || [];
    const asset = assets.find((a) => a.id === id);
    if (!asset) {
      return new HttpResponse(null, { status: 404 });
    }
    Object.assign(asset, updates);
    return HttpResponse.json(asset);
  }),

  // Audio - Waveform
  http.get(`${API_BASE}/audio/:audioType/:id/waveform`, () => {
    return HttpResponse.json({
      waveform: Array(100).fill(0).map(() => Math.random()),
      duration: 180
    });
  }),

  // Audio stats
  http.get(`${API_BASE}/audio/stats`, () => {
    return HttpResponse.json(mockAudioStats);
  }),

  // Audio queue
  http.get(`${API_BASE}/audio/generate/queue`, () => {
    return HttpResponse.json(mockAudioQueue);
  }),

  // Generate audio
  http.post(`${API_BASE}/audio/generate`, async ({ request }) => {
    const body = await request.json();
    const job = {
      id: `audio_${Date.now()}`,
      type: body.type,
      filters: body.filters,
      status: 'queued',
      createdAt: new Date().toISOString()
    };
    return HttpResponse.json({ success: true, job });
  }),

  // Cancel audio job
  http.post(`${API_BASE}/audio/generate/cancel`, async ({ request }) => {
    const { jobId, all } = await request.json();
    return HttpResponse.json({
      success: true,
      cancelled: all ? 3 : 1,
      jobId
    });
  }),

  // Audio regeneration queue
  http.get(`${API_BASE}/audio/regeneration-queue`, () => {
    return HttpResponse.json({
      music: [],
      sfx: [mockAudioAssets.sfx[0]]
    });
  }),

  // Mark audio for regeneration
  http.put(`${API_BASE}/audio/:audioType/:id/mark-regeneration`, async ({ params, request }) => {
    const { audioType, id } = params;
    const { mark } = await request.json();
    const assets = mockAudioAssets[audioType] || [];
    const asset = assets.find((a) => a.id === id);
    if (!asset) {
      return new HttpResponse(null, { status: 404 });
    }
    asset.needsRegeneration = mark;
    return HttpResponse.json({ success: true, asset });
  }),

  // Bulk mark audio
  http.put(`${API_BASE}/audio/mark-multiple`, async ({ request }) => {
    const { type, ids, mark } = await request.json();
    const assets = mockAudioAssets[type] || [];
    let updated = 0;
    ids.forEach((id) => {
      const asset = assets.find((a) => a.id === id);
      if (asset) {
        asset.needsRegeneration = mark;
        updated++;
      }
    });
    return HttpResponse.json({ success: true, updated });
  }),

  // Validate SFX prompt
  http.post(`${API_BASE}/audio/sfx/validate`, async ({ request }) => {
    const { prompt } = await request.json();
    const commaCount = (prompt.match(/,/g) || []).length;
    const isValid = commaCount <= 1;
    return HttpResponse.json({
      valid: isValid,
      commaCount,
      message: isValid ? 'Prompt is valid' : 'Too many commas in prompt'
    });
  }),

  // Backups
  http.get(`${API_BASE}/backups`, () => {
    return HttpResponse.json({ backups: mockBackups });
  }),

  http.post(`${API_BASE}/backups`, async ({ request }) => {
    const body = await request.json();
    const backup = {
      timestamp: new Date().toISOString(),
      reason: body.reason || 'manual',
      size: 1024000,
      categories: body.categories || ['tiles', 'portraits']
    };
    return HttpResponse.json({ success: true, backup });
  }),

  http.get(`${API_BASE}/backups/:timestamp`, ({ params }) => {
    const backup = mockBackups.find((b) => b.timestamp === params.timestamp);
    if (!backup) {
      return new HttpResponse(null, { status: 404 });
    }
    return HttpResponse.json(backup);
  }),

  http.post(`${API_BASE}/backups/:timestamp/restore`, () => {
    return HttpResponse.json({ success: true, restored: true });
  }),

  http.delete(`${API_BASE}/backups/:timestamp`, () => {
    return HttpResponse.json({ success: true, deleted: true });
  }),

  // Theme
  http.get(`${API_BASE}/theme`, () => {
    return HttpResponse.json(mockTheme);
  }),

  http.put(`${API_BASE}/theme`, async ({ request }) => {
    const updates = await request.json();
    Object.assign(mockTheme, updates);
    return HttpResponse.json(mockTheme);
  }),

  // Theme presets
  http.get(`${API_BASE}/theme/presets`, () => {
    return HttpResponse.json({
      presets: [
        { name: 'default', description: 'Default theme' },
        { name: 'dark', description: 'Dark theme' }
      ]
    });
  }),

  http.post(`${API_BASE}/theme/presets`, async ({ request }) => {
    const { name, description } = await request.json();
    return HttpResponse.json({ success: true, name, description });
  }),

  http.post(`${API_BASE}/theme/presets/:name/apply`, () => {
    return HttpResponse.json({ success: true, applied: true });
  }),

  http.delete(`${API_BASE}/theme/presets/:name`, () => {
    return HttpResponse.json({ success: true, deleted: true });
  })
];

export default handlers;
