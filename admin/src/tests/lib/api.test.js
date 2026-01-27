/**
 * API Client Tests
 * Tests for the modular API client
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { api } from '../../lib/api';

describe('API Client', () => {
  describe('Config API', () => {
    it('should get config', async () => {
      const config = await api.getConfig();
      expect(config).toBeDefined();
      expect(config.categories).toContain('tiles');
    });

    it('should get stats', async () => {
      const stats = await api.getStats();
      expect(stats).toBeDefined();
      expect(stats.tiles).toBeDefined();
    });

    it('should get status', async () => {
      const status = await api.getStatus();
      expect(status).toBeDefined();
      expect(status.enabled).toBe(true);
    });
  });

  describe('Assets API', () => {
    it('should get assets', async () => {
      const response = await api.getAssets('tiles');
      expect(response.assets).toBeDefined();
      expect(Array.isArray(response.assets)).toBe(true);
    });

    it('should get assets with filters', async () => {
      const response = await api.getAssets('tiles', {
        status: 'generated',
        biome: 'forest',
      });
      expect(response.assets).toBeDefined();
    });

    it('should get single asset', async () => {
      server.use(
        http.get('/api/admin/assets/tiles/forest_grass_1', () => {
          return HttpResponse.json({
            id: 'forest_grass_1',
            category: 'tiles',
            status: 'exists',
          });
        })
      );

      const asset = await api.getAsset('tiles', 'forest_grass_1');
      expect(asset.id).toBe('forest_grass_1');
    });

    it('should update asset', async () => {
      server.use(
        http.put('/api/admin/assets/tiles/forest_grass_1', () => {
          return HttpResponse.json({
            success: true,
            asset: { id: 'forest_grass_1', status: 'exists' },
          });
        })
      );

      const result = await api.updateAsset('tiles', 'forest_grass_1', {
        prompt: 'new prompt',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Audio API', () => {
    it('should get audio assets', async () => {
      const response = await api.getAudioAssets('music');
      expect(response.assets).toBeDefined();
      expect(Array.isArray(response.assets)).toBe(true);
    });

    it('should get audio stats', async () => {
      const stats = await api.getAudioStats();
      expect(stats).toBeDefined();
    });
  });

  describe('Generation API', () => {
    it('should get queue', async () => {
      const queue = await api.getQueue();
      expect(queue.current).toBeNull();
      expect(queue.pending).toEqual([]);
    });

    it('should queue generation', async () => {
      server.use(
        http.post('/api/admin/generate', () => {
          return HttpResponse.json({
            success: true,
            job: { id: 'job_1', category: 'tiles', status: 'queued' },
          });
        })
      );

      const result = await api.generateAssets('tiles', { biome: 'forest' });
      expect(result.success).toBe(true);
      expect(result.job.category).toBe('tiles');
    });

    it('should cancel job', async () => {
      server.use(
        http.post('/api/admin/generate/cancel', () => {
          return HttpResponse.json({ success: true });
        })
      );

      const result = await api.cancelJob('job_1');
      expect(result.success).toBe(true);
    });
  });

  describe('Backups API', () => {
    it('should get backups', async () => {
      const response = await api.getBackups();
      expect(response.backups).toBeDefined();
      expect(Array.isArray(response.backups)).toBe(true);
    });

    it('should create backup', async () => {
      const result = await api.createBackup('test');
      expect(result.success).toBe(true);
      expect(result.backup.reason).toBe('test');
    });

    it('should restore backup', async () => {
      server.use(
        http.post('/api/admin/backups/:timestamp/restore', () => {
          return HttpResponse.json({ success: true });
        })
      );

      const result = await api.restoreBackup('2024-01-01_12-00-00');
      expect(result.success).toBe(true);
    });

    it('should delete backup', async () => {
      server.use(
        http.delete('/api/admin/backups/:timestamp', () => {
          return HttpResponse.json({ success: true });
        })
      );

      const result = await api.deleteBackup('2024-01-01_12-00-00');
      expect(result.success).toBe(true);
    });
  });

  describe('Theme API', () => {
    it('should get theme', async () => {
      const theme = await api.getTheme();
      expect(theme).toBeDefined();
    });

    it('should update theme', async () => {
      server.use(
        http.put('/api/admin/theme', () => {
          return HttpResponse.json({
            success: true,
            theme: { name: 'updated' },
          });
        })
      );

      const result = await api.updateTheme({ negativePrompt: 'test' });
      expect(result.success).toBe(true);
    });

    it('should get theme presets', async () => {
      const presets = await api.getThemePresets();
      expect(presets).toBeDefined();
      expect(Array.isArray(presets.presets)).toBe(true);
    });
  });

  describe('Regeneration Queue API', () => {
    it('should get regeneration queue', async () => {
      const queue = await api.getRegenerationQueue();
      expect(queue).toBeDefined();
      expect(queue.tiles).toBeDefined();
    });

    it('should mark for regeneration', async () => {
      const result = await api.markForRegeneration('tiles', 'forest_grass_1', true);
      expect(result.success).toBe(true);
    });

    it('should mark multiple for regeneration', async () => {
      server.use(
        http.put('/api/admin/assets/mark-multiple', () => {
          return HttpResponse.json({
            success: true,
            updated: 2,
          });
        })
      );

      const result = await api.markMultipleForRegeneration('tiles', ['a', 'b'], true);
      expect(result.success).toBe(true);
    });

    it('should bulk update multiple assets', async () => {
      server.use(
        http.post('/api/admin/assets/bulk-update', () => {
          return HttpResponse.json({
            success: true,
            updated: 3,
            notFound: 0,
            errors: []
          });
        })
      );

      const result = await api.bulkUpdateAssets('tiles', ['a', 'b', 'c'], { priority: 2 });
      expect(result.success).toBe(true);
      expect(result.updated).toBe(3);
    });

    it('should handle bulk update validation errors', async () => {
      server.use(
        http.post('/api/admin/assets/bulk-update', () => {
          return HttpResponse.json(
            { error: 'assetIds array cannot be empty' },
            { status: 400 }
          );
        })
      );

      await expect(api.bulkUpdateAssets('tiles', [], {})).rejects.toThrow('assetIds array cannot be empty');
    });

    it('should handle invalid loraModel in bulk update', async () => {
      server.use(
        http.post('/api/admin/assets/bulk-update', () => {
          return HttpResponse.json(
            { error: 'Invalid loraModel: invalid-model' },
            { status: 400 }
          );
        })
      );

      await expect(
        api.bulkUpdateAssets('tiles', ['a'], { loraModel: 'invalid-model' })
      ).rejects.toThrow('Invalid loraModel');
    });
  });

  describe('Error Handling', () => {
    it('should handle 404 errors', async () => {
      server.use(
        http.get('/api/admin/assets/tiles/nonexistent', () => {
          return HttpResponse.json(
            { error: 'Asset not found' },
            { status: 404 }
          );
        })
      );

      await expect(api.getAsset('tiles', 'nonexistent')).rejects.toThrow('Asset not found');
    });

    it('should handle 500 errors', async () => {
      server.use(
        http.get('/api/admin/config', () => {
          return HttpResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
          );
        })
      );

      await expect(api.getConfig()).rejects.toThrow('Internal server error');
    });
  });
});
