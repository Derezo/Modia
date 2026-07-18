/**
 * Canonical timing shared by character animation presenters. Idle artwork uses
 * deliberately subtle pose changes, so it should read as a slow pose cycle
 * instead of action-speed animation.
 */
export const IDLE_FRAME_DURATION_MS = 2000;
export const IDLE_FRAME_RATE = 1000 / IDLE_FRAME_DURATION_MS;

/**
 * Advance a looping idle pose index without coupling it to positional bobbing.
 * Returning the remainder makes large or irregular update intervals stable.
 */
export function advanceIdleFrame(frame, elapsedMs, deltaTimeMs, frameCount = 8) {
  const total = elapsedMs + deltaTimeMs;
  const steps = Math.floor(total / IDLE_FRAME_DURATION_MS);
  return {
    frame: (frame + steps) % frameCount,
    elapsedMs: total % IDLE_FRAME_DURATION_MS
  };
}
