import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  determineOverallHealthStatus
} from '../../services/healthStatus.js';

const healthyInputs = Object.freeze({
  databaseAvailable: true,
  terminalDeliveryAvailable: true,
  terminalWorkerReady: true,
  terminalEffectsExhausted: false,
  redisAvailable: true,
  battleMapsDegraded: false
});

describe('health status aggregation', () => {
  it('reports healthy only when infrastructure and operational signals are healthy', () => {
    assert.equal(determineOverallHealthStatus(healthyInputs), 'healthy');
  });

  it('preserves unhealthy precedence for required persistence dependencies', () => {
    assert.equal(determineOverallHealthStatus({
      ...healthyInputs,
      databaseAvailable: false,
      battleMapsDegraded: true
    }), 'unhealthy');
    assert.equal(determineOverallHealthStatus({
      ...healthyInputs,
      terminalDeliveryAvailable: false
    }), 'unhealthy');
  });

  it('degrades for terminal, Redis, or battle-map operational failures', () => {
    for (const overrides of [
      { terminalWorkerReady: false },
      { terminalEffectsExhausted: true },
      { redisAvailable: false },
      { battleMapsDegraded: true }
    ]) {
      assert.equal(
        determineOverallHealthStatus({ ...healthyInputs, ...overrides }),
        'degraded'
      );
    }
  });
});
