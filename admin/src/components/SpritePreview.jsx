/**
 * SpritePreview - Animated sprite sheet preview component
 *
 * Handles vertical sprite strips (64x512 = 8 frames stacked vertically).
 * Uses requestAnimationFrame for smooth animation with proper cleanup.
 * Pauses animation when not visible (Intersection Observer).
 *
 * Frame Layout:
 * - Frames 0-3: Idle animation
 * - Frames 4-7: Walk/action animation
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { ImageIcon } from '@radix-ui/react-icons';

/**
 * Default props for standard character sprite sheets
 */
const DEFAULT_FRAME_WIDTH = 64;
const DEFAULT_FRAME_HEIGHT = 64;
const DEFAULT_FRAME_COUNT = 8;
const DEFAULT_FPS = 8;

export default function SpritePreview({
  src,
  frameWidth = DEFAULT_FRAME_WIDTH,
  frameHeight = DEFAULT_FRAME_HEIGHT,
  frameCount = DEFAULT_FRAME_COUNT,
  fps = DEFAULT_FPS,
  animate = true,
  className = '',
  onLoad,
  onError,
}) {
  const [currentFrame, setCurrentFrame] = useState(0);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const containerRef = useRef(null);
  const animationFrameRef = useRef(null);
  const lastFrameTimeRef = useRef(0);

  /**
   * Draw a specific frame to the canvas
   */
  const drawFrame = useCallback((frame) => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || !imageLoaded) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, frameWidth, frameHeight);

    // For vertical strip: sourceY = frame * frameHeight
    ctx.drawImage(
      img,
      0, frame * frameHeight,    // source x, y
      frameWidth, frameHeight,   // source width, height
      0, 0,                      // dest x, y
      frameWidth, frameHeight    // dest width, height
    );
  }, [frameWidth, frameHeight, imageLoaded]);

  /**
   * Load the sprite sheet image
   */
  useEffect(() => {
    if (!src) {
      setImageError(true);
      return;
    }

    setImageLoaded(false);
    setImageError(false);
    setCurrentFrame(0);

    const img = new Image();

    img.onload = () => {
      imageRef.current = img;
      setImageLoaded(true);
      onLoad?.();
    };

    img.onerror = () => {
      setImageError(true);
      onError?.();
    };

    img.src = src;

    return () => {
      // Cleanup: prevent state updates on unmounted component
      img.onload = null;
      img.onerror = null;
    };
  }, [src, onLoad, onError]);

  /**
   * Draw frame when currentFrame changes
   */
  useEffect(() => {
    drawFrame(currentFrame);
  }, [currentFrame, drawFrame]);

  /**
   * Animation loop using requestAnimationFrame for smooth playback
   */
  useEffect(() => {
    if (!animate || !imageLoaded || !isVisible) {
      // Draw initial frame when not animating
      if (imageLoaded) {
        drawFrame(0);
      }
      return;
    }

    const frameDuration = 1000 / fps;

    const tick = (timestamp) => {
      if (!lastFrameTimeRef.current) {
        lastFrameTimeRef.current = timestamp;
      }

      const elapsed = timestamp - lastFrameTimeRef.current;

      if (elapsed >= frameDuration) {
        setCurrentFrame((f) => (f + 1) % frameCount);
        lastFrameTimeRef.current = timestamp - (elapsed % frameDuration);
      }

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      lastFrameTimeRef.current = 0;
    };
  }, [animate, imageLoaded, isVisible, fps, frameCount, drawFrame]);

  /**
   * Intersection Observer to pause animation when not visible
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setIsVisible(entry.isIntersecting);
        });
      },
      {
        threshold: 0.1,
        rootMargin: '50px',
      }
    );

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  /**
   * Render error state
   */
  if (imageError || !src) {
    return (
      <div
        ref={containerRef}
        className={`flex items-center justify-center bg-midnight-950 ${className}`}
        style={{ width: frameWidth, height: frameHeight }}
      >
        <ImageIcon className="w-6 h-6 text-parchment-600" />
      </div>
    );
  }

  /**
   * Render loading state
   */
  if (!imageLoaded) {
    return (
      <div
        ref={containerRef}
        className={`flex items-center justify-center bg-midnight-950 ${className}`}
        style={{ width: frameWidth, height: frameHeight }}
      >
        <div className="w-6 h-6 border-2 border-midnight-600 border-t-accent-gold rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div ref={containerRef} className={className}>
      <canvas
        ref={canvasRef}
        width={frameWidth}
        height={frameHeight}
        style={{
          imageRendering: 'pixelated',
          display: 'block',
        }}
      />
    </div>
  );
}

/**
 * SpritePreviewStatic - Non-animated version showing first frame only
 * Lighter weight for thumbnail contexts where animation is disabled
 */
export function SpritePreviewStatic({
  src,
  frameWidth = DEFAULT_FRAME_WIDTH,
  frameHeight = DEFAULT_FRAME_HEIGHT,
  className = '',
  onLoad,
  onError,
}) {
  return (
    <SpritePreview
      src={src}
      frameWidth={frameWidth}
      frameHeight={frameHeight}
      animate={false}
      className={className}
      onLoad={onLoad}
      onError={onError}
    />
  );
}
