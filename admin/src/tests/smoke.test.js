/**
 * Smoke Test
 * Verifies the testing infrastructure is working correctly
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import { api } from '../lib/api';
import {
  createTileAsset,
  createMusicAsset,
  createGenerationJob,
  resetIdCounter
} from './utils/factories';

describe('Testing Infrastructure Smoke Test', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe('MSW Server', () => {
    it('should intercept API calls', async () => {
      const stats = await api.getStats();
      expect(stats).toBeDefined();
      expect(stats.tiles).toBeDefined();
    });

    it('should allow handler overrides', async () => {
      server.use(
        http.get('/api/admin/stats', () => {
          return HttpResponse.json({ custom: true });
        })
      );

      const stats = await api.getStats();
      expect(stats.custom).toBe(true);
    });

    it('should intercept asset requests', async () => {
      const response = await api.getAssets('tiles');
      expect(response.assets).toBeDefined();
      expect(Array.isArray(response.assets)).toBe(true);
    });

    it('should intercept audio requests', async () => {
      const response = await api.getAudioAssets('music');
      expect(response.assets).toBeDefined();
      expect(Array.isArray(response.assets)).toBe(true);
    });
  });

  describe('Test Factories', () => {
    it('should create tile assets', () => {
      const tile = createTileAsset();
      expect(tile.id).toMatch(/^tile_/);
      expect(tile.category).toBe('tiles');
      expect(tile.status).toBe('exists');
    });

    it('should create tile assets with overrides', () => {
      const tile = createTileAsset({
        id: 'custom_tile',
        biome: 'cave',
        status: 'missing'
      });
      expect(tile.id).toBe('custom_tile');
      expect(tile.biome).toBe('cave');
      expect(tile.status).toBe('missing');
    });

    it('should create music assets', () => {
      const music = createMusicAsset();
      expect(music.id).toMatch(/^music_/);
      expect(music.type).toBe('music');
      expect(music.region).toBe('heartlands');
    });

    it('should create generation jobs', () => {
      const job = createGenerationJob({ category: 'portraits' });
      expect(job.id).toMatch(/^job_/);
      expect(job.category).toBe('portraits');
      expect(job.status).toBe('queued');
    });

    it('should reset ID counter', () => {
      const first = createTileAsset();
      resetIdCounter();
      const second = createTileAsset();
      expect(first.id).toBe(second.id);
    });
  });

  describe('Mocked APIs', () => {
    it('should mock window.matchMedia', () => {
      expect(window.matchMedia).toBeDefined();
      const result = window.matchMedia('(min-width: 768px)');
      expect(result.matches).toBe(false);
    });

    it('should mock localStorage', () => {
      localStorage.setItem('test', 'value');
      expect(localStorage.getItem('test')).toBe('value');
      localStorage.removeItem('test');
      expect(localStorage.getItem('test')).toBeNull();
    });

    it('should mock ResizeObserver', () => {
      expect(global.ResizeObserver).toBeDefined();
      const observer = new ResizeObserver(() => {});
      expect(observer.observe).toBeDefined();
      expect(observer.disconnect).toBeDefined();
    });

    it('should mock IntersectionObserver', () => {
      expect(global.IntersectionObserver).toBeDefined();
      const observer = new IntersectionObserver(() => {});
      expect(observer.observe).toBeDefined();
      expect(observer.disconnect).toBeDefined();
    });
  });

  describe('API Client', () => {
    it('should get config', async () => {
      const config = await api.getConfig();
      expect(config.categories).toContain('tiles');
      expect(config.audioTypes).toContain('music');
    });

    it('should get queue status', async () => {
      const queue = await api.getQueue();
      expect(queue.current).toBeNull();
      expect(queue.pending).toEqual([]);
    });

    it('should get regeneration queue', async () => {
      const queue = await api.getRegenerationQueue();
      expect(queue.tiles).toBeDefined();
      expect(queue.music).toBeDefined();
    });

    it('should mark asset for regeneration', async () => {
      const result = await api.markForRegeneration('tiles', 'forest_grass_1', true);
      expect(result.success).toBe(true);
    });

    it('should create backup', async () => {
      const result = await api.createBackup('test');
      expect(result.success).toBe(true);
      expect(result.backup.reason).toBe('test');
    });
  });
});
