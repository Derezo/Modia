/**
 * Combine dependency and subsystem health without allowing a degraded
 * operational signal to be hidden by otherwise healthy infrastructure.
 */
export function determineOverallHealthStatus({
  databaseAvailable,
  terminalDeliveryAvailable,
  terminalWorkerReady,
  terminalEffectsExhausted = false,
  redisAvailable = true,
  battleMapsDegraded = false
}) {
  if (!databaseAvailable || !terminalDeliveryAvailable) return 'unhealthy';
  if (
    !terminalWorkerReady
    || terminalEffectsExhausted
    || !redisAvailable
    || battleMapsDegraded
  ) {
    return 'degraded';
  }
  return 'healthy';
}
