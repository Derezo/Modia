/**
 * useTheme - Hook for theme CRUD operations
 * Manages theme configuration for AI image generation prompts
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

/**
 * Hook to fetch and manage theme configuration
 */
export function useTheme() {
  const [theme, setTheme] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Fetch the current theme configuration
   */
  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await api.getTheme();
      setTheme(data);
    } catch (err) {
      setError(err.message);
      console.error('Failed to fetch theme:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  /**
   * Update theme configuration
   * @param {Object} updates - Partial theme updates
   */
  const updateTheme = useCallback(async (updates) => {
    setSaving(true);
    setError(null);

    try {
      const updatedTheme = await api.updateTheme(updates);
      setTheme(updatedTheme);
      return updatedTheme;
    } catch (err) {
      setError(err.message);
      console.error('Failed to update theme:', err);
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  /**
   * Update a specific field in the theme
   * @param {string} path - Dot-notation path (e.g., 'style.trigger')
   * @param {*} value - New value
   */
  const updateField = useCallback(async (path, value) => {
    // Build nested update object from path
    const parts = path.split('.');
    const update = {};
    let current = update;

    for (let i = 0; i < parts.length - 1; i++) {
      current[parts[i]] = {};
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;

    return updateTheme(update);
  }, [updateTheme]);

  /**
   * Update a category modifier
   * @param {string} category - Category name (e.g., 'tiles', 'portraits')
   * @param {Object} modifier - Modifier configuration
   */
  const updateCategoryModifier = useCallback(async (category, modifier) => {
    return updateTheme({
      categoryModifiers: {
        [category]: modifier,
      },
    });
  }, [updateTheme]);

  /**
   * Update LoRA defaults for a category
   * @param {string} category - Category name
   * @param {string} loraVersion - LoRA version (e.g., 'v1', 'v2')
   */
  const updateLoraDefault = useCallback(async (category, loraVersion) => {
    return updateTheme({
      loraDefaults: {
        [category]: loraVersion,
      },
    });
  }, [updateTheme]);

  /**
   * Build a preview prompt for a given category
   * @param {string} category - Asset category
   * @param {string} subject - Subject description
   * @returns {Object} - Prompt parts for preview
   */
  const buildPromptPreview = useCallback((category, subject = 'example subject') => {
    if (!theme) return null;

    const { style, categoryModifiers, negativePrompt } = theme;
    const categoryMod = categoryModifiers?.[category];

    const parts = [];

    // Style trigger
    if (style?.trigger) {
      parts.push(style.trigger);
    }

    // Base phrase
    if (style?.basePhrase) {
      parts.push(style.basePhrase);
    }

    // Subject
    parts.push(subject);

    // Category suffix
    if (categoryMod?.suffix) {
      parts.push(categoryMod.suffix);
    }

    // Technique and texture
    if (style?.technique) {
      parts.push(style.technique);
    }
    if (style?.texture) {
      parts.push(style.texture);
    }

    return {
      positivePrompt: parts.join(', '),
      negativePrompt: negativePrompt || '',
      size: categoryMod?.size || '128x128',
    };
  }, [theme]);

  return {
    theme,
    loading,
    saving,
    error,
    refetch,
    updateTheme,
    updateField,
    updateCategoryModifier,
    updateLoraDefault,
    buildPromptPreview,
  };
}

export default useTheme;
