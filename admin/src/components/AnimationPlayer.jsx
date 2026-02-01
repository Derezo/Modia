/**
 * AnimationPlayer - Canvas-based animation playback component with controls
 *
 * Provides full playback controls for vertical sprite sheet animations:
 * - Play/pause toggle
 * - Speed control slider (FPS)
 * - Frame scrubber for manual frame selection
 * - Loop toggle
 * - Frame counter display
 *
 * Sprite sheets are expected to be VERTICAL strips (frames stacked vertically).
 * Frame extraction: sourceY = frameIndex * frameHeight
 *
 * @example
 * <AnimationPlayer
 *   spriteSheet="/assets/characters/player/warrior/warrior_idle.png"
 *   frameWidth={64}
 *   frameHeight={64}
 *   frameCount={8}
 *   defaultFps={8}
 * />
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  PlayIcon,
  PauseIcon,
  LoopIcon,
  ResetIcon,
  TrackNextIcon,
  TrackPreviousIcon,
  ImageIcon,
} from '@radix-ui/react-icons';

/**
 * Default configuration values
 */
const DEFAULT_FRAME_WIDTH = 64;
const DEFAULT_FRAME_HEIGHT = 64;
const DEFAULT_FRAME_COUNT = 8;
const DEFAULT_FPS = 8;
const MIN_FPS = 1;
const MAX_FPS = 30;

export default function AnimationPlayer({
  spriteSheet,
  frameWidth = DEFAULT_FRAME_WIDTH,
  frameHeight = DEFAULT_FRAME_HEIGHT,
  frameCount = DEFAULT_FRAME_COUNT,
  defaultFps = DEFAULT_FPS,
  className = '',
  onLoad,
  onError,
}) {
  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(true);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [fps, setFps] = useState(defaultFps);

  // Image loading state
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Refs for animation
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
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

    // Clear canvas
    ctx.clearRect(0, 0, frameWidth, frameHeight);

    // For vertical strip: sourceY = frame * frameHeight
    ctx.drawImage(
      img,
      0, frame * frameHeight,    // source x, y (vertical strip)
      frameWidth, frameHeight,   // source width, height
      0, 0,                      // dest x, y
      frameWidth, frameHeight    // dest width, height
    );
  }, [frameWidth, frameHeight, imageLoaded]);

  /**
   * Load the sprite sheet image
   */
  useEffect(() => {
    if (!spriteSheet) {
      setImageError(true);
      return;
    }

    setImageLoaded(false);
    setImageError(false);
    setCurrentFrame(0);
    setIsPlaying(false);

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

    img.src = spriteSheet;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [spriteSheet, onLoad, onError]);

  /**
   * Draw frame when currentFrame changes
   */
  useEffect(() => {
    if (imageLoaded) {
      drawFrame(currentFrame);
    }
  }, [currentFrame, drawFrame, imageLoaded]);

  /**
   * Animation loop using requestAnimationFrame
   */
  useEffect(() => {
    if (!isPlaying || !imageLoaded) {
      return;
    }

    const frameDuration = 1000 / fps;

    const tick = (timestamp) => {
      if (!lastFrameTimeRef.current) {
        lastFrameTimeRef.current = timestamp;
      }

      const elapsed = timestamp - lastFrameTimeRef.current;

      if (elapsed >= frameDuration) {
        setCurrentFrame((prevFrame) => {
          const nextFrame = prevFrame + 1;

          // Handle end of animation
          if (nextFrame >= frameCount) {
            if (isLooping) {
              return 0; // Loop back to start
            } else {
              // Stop at last frame
              setIsPlaying(false);
              return prevFrame;
            }
          }

          return nextFrame;
        });

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
  }, [isPlaying, imageLoaded, fps, frameCount, isLooping]);

  /**
   * Toggle play/pause
   */
  const handlePlayPause = useCallback(() => {
    if (!imageLoaded) return;

    // If at end and not looping, reset to start when playing
    if (!isPlaying && currentFrame === frameCount - 1 && !isLooping) {
      setCurrentFrame(0);
    }

    setIsPlaying((prev) => !prev);
  }, [imageLoaded, isPlaying, currentFrame, frameCount, isLooping]);

  /**
   * Reset to first frame
   */
  const handleReset = useCallback(() => {
    setCurrentFrame(0);
    setIsPlaying(false);
  }, []);

  /**
   * Step to previous frame
   */
  const handlePrevFrame = useCallback(() => {
    setIsPlaying(false);
    setCurrentFrame((prev) => (prev > 0 ? prev - 1 : frameCount - 1));
  }, [frameCount]);

  /**
   * Step to next frame
   */
  const handleNextFrame = useCallback(() => {
    setIsPlaying(false);
    setCurrentFrame((prev) => (prev < frameCount - 1 ? prev + 1 : 0));
  }, [frameCount]);

  /**
   * Handle scrubber change
   */
  const handleScrubberChange = useCallback((e) => {
    const frame = parseInt(e.target.value, 10);
    setCurrentFrame(frame);
    // Don't stop playback when scrubbing
  }, []);

  /**
   * Handle FPS slider change
   */
  const handleFpsChange = useCallback((e) => {
    const newFps = parseInt(e.target.value, 10);
    setFps(newFps);
  }, []);

  /**
   * Toggle looping
   */
  const handleToggleLoop = useCallback(() => {
    setIsLooping((prev) => !prev);
  }, []);

  /**
   * Calculate frame timing display
   */
  const frameDuration = (1000 / fps).toFixed(1);
  const currentTime = ((currentFrame / fps) * 1000).toFixed(0);
  const totalTime = ((frameCount / fps) * 1000).toFixed(0);

  /**
   * Render error state
   */
  if (imageError || !spriteSheet) {
    return (
      <div className={`flex flex-col items-center justify-center bg-midnight-950 rounded-lg p-8 ${className}`}>
        <ImageIcon className="w-12 h-12 text-parchment-600 mb-3" />
        <p className="text-parchment-500 text-sm">Failed to load sprite sheet</p>
        {spriteSheet && (
          <p className="text-parchment-600 text-xs mt-1 break-all max-w-xs text-center">
            {spriteSheet}
          </p>
        )}
      </div>
    );
  }

  /**
   * Render loading state
   */
  if (!imageLoaded) {
    return (
      <div className={`flex flex-col items-center justify-center bg-midnight-950 rounded-lg p-8 ${className}`}>
        <div className="w-8 h-8 border-2 border-midnight-600 border-t-accent-gold rounded-full animate-spin mb-3" />
        <p className="text-parchment-500 text-sm">Loading sprite sheet...</p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col bg-midnight-900 border border-midnight-700 rounded-lg overflow-hidden ${className}`}>
      {/* Canvas Preview Area */}
      <div className="flex items-center justify-center bg-midnight-950 p-4 min-h-[160px]">
        <div
          className="relative"
          style={{
            width: frameWidth * 2,
            height: frameHeight * 2,
          }}
        >
          <canvas
            ref={canvasRef}
            width={frameWidth}
            height={frameHeight}
            className="w-full h-full"
            style={{
              imageRendering: 'pixelated',
            }}
          />
        </div>
      </div>

      {/* Controls Area */}
      <div className="p-4 space-y-4 border-t border-midnight-700">
        {/* Playback Controls */}
        <div className="flex items-center justify-center gap-2">
          {/* Reset Button */}
          <button
            type="button"
            onClick={handleReset}
            className="p-2 text-parchment-400 hover:text-parchment-200 hover:bg-midnight-800 rounded-lg transition-colors"
            title="Reset to first frame"
          >
            <ResetIcon className="w-4 h-4" />
          </button>

          {/* Previous Frame */}
          <button
            type="button"
            onClick={handlePrevFrame}
            className="p-2 text-parchment-400 hover:text-parchment-200 hover:bg-midnight-800 rounded-lg transition-colors"
            title="Previous frame"
          >
            <TrackPreviousIcon className="w-4 h-4" />
          </button>

          {/* Play/Pause Button */}
          <button
            type="button"
            onClick={handlePlayPause}
            className="p-3 bg-accent-gold text-midnight-950 rounded-full hover:bg-accent-gold/90 transition-colors"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <PauseIcon className="w-5 h-5" />
            ) : (
              <PlayIcon className="w-5 h-5" />
            )}
          </button>

          {/* Next Frame */}
          <button
            type="button"
            onClick={handleNextFrame}
            className="p-2 text-parchment-400 hover:text-parchment-200 hover:bg-midnight-800 rounded-lg transition-colors"
            title="Next frame"
          >
            <TrackNextIcon className="w-4 h-4" />
          </button>

          {/* Loop Toggle */}
          <button
            type="button"
            onClick={handleToggleLoop}
            className={`p-2 rounded-lg transition-colors ${
              isLooping
                ? 'text-accent-gold bg-midnight-800'
                : 'text-parchment-500 hover:text-parchment-300 hover:bg-midnight-800'
            }`}
            title={isLooping ? 'Looping enabled' : 'Looping disabled'}
          >
            <LoopIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Frame Scrubber */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-parchment-400">
            <span>Frame</span>
            <span>
              {currentFrame + 1} / {frameCount}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max={frameCount - 1}
            value={currentFrame}
            onChange={handleScrubberChange}
            className="w-full h-2 bg-midnight-700 rounded-lg appearance-none cursor-pointer accent-accent-gold"
          />
          <div className="flex items-center justify-between text-xs text-parchment-500">
            <span>{currentTime}ms</span>
            <span>{totalTime}ms</span>
          </div>
        </div>

        {/* Speed Control */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-parchment-400">
            <span>Speed</span>
            <span>{fps} FPS ({frameDuration}ms/frame)</span>
          </div>
          <input
            type="range"
            min={MIN_FPS}
            max={MAX_FPS}
            value={fps}
            onChange={handleFpsChange}
            className="w-full h-2 bg-midnight-700 rounded-lg appearance-none cursor-pointer accent-accent-gold"
          />
          <div className="flex items-center justify-between text-xs text-parchment-500">
            <span>{MIN_FPS} FPS</span>
            <span>{MAX_FPS} FPS</span>
          </div>
        </div>
      </div>
    </div>
  );
}
