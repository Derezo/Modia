const METRIC_NAMES = [
  'casts',
  'tackleUsed',
  'missedHooks',
  'reelFailures',
  'bigCatchTriggers',
  'bigCatchLands',
  'invalidTransitions',
  'settlements',
  'settlementValue',
  'creditedGold',
  'overflowGold'
];

function emptyCounters() {
  return Object.fromEntries(METRIC_NAMES.map(name => [name, 0]));
}

let startedAt = Date.now();
let counters = emptyCounters();
let bigCatchLandsByRod = Object.create(null);
let bigCatchTriggersByRod = Object.create(null);

export function incrementFishingMetric(name, amount = 1, labels = {}) {
  if (Object.hasOwn(counters, name)) {
    counters[name] += Number(amount) || 0;
  }

  if (name === 'bigCatchTriggers' && labels.rodKey) {
    bigCatchTriggersByRod[labels.rodKey] =
      (bigCatchTriggersByRod[labels.rodKey] || 0) + (Number(amount) || 0);
  }
  if (name === 'bigCatchLands' && labels.rodKey) {
    bigCatchLandsByRod[labels.rodKey] =
      (bigCatchLandsByRod[labels.rodKey] || 0) + (Number(amount) || 0);
  }
}

export function getFishingMetrics() {
  const elapsedHours = Math.max((Date.now() - startedAt) / 3_600_000, 1 / 3_600_000);
  return {
    counters: { ...counters },
    bigCatchTriggersByRod: { ...bigCatchTriggersByRod },
    bigCatchLandsByRod: { ...bigCatchLandsByRod },
    observedGoldPerHour: Number((counters.creditedGold / elapsedHours).toFixed(2)),
    startedAt: new Date(startedAt).toISOString()
  };
}

export function resetFishingMetricsForTests() {
  startedAt = Date.now();
  counters = emptyCounters();
  bigCatchLandsByRod = Object.create(null);
  bigCatchTriggersByRod = Object.create(null);
}
