#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NODE_DISTRIBUTION, PHASE6_CONFIG } from '../db/worldgen/constants.js';
import { assembleWorld } from '../db/worldgen/worldAssembly.js';

function integerFlag(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (raw === undefined) return fallback;
  if (!/^-?\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  return Number(raw);
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

export function summary(values) {
  if (values.length === 0) {
    return { min: null, p50: null, p95: null, max: null };
  }

  let minimum = values[0];
  let maximum = values[0];
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index];
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }

  return {
    min: minimum,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: maximum
  };
}

function quietAssembly(seed) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    return assembleWorld({ seed });
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

export function generateCorpusReport(startSeed, endSeed) {
  if (!Number.isInteger(startSeed) || !Number.isInteger(endSeed) || endSeed < startSeed) {
    throw new Error('seed range must be ascending integers');
  }

  const nodeCounts = [];
  const connectionCounts = [];
  const deadEndShares = [];
  let rewardSitesAssigned = 0;
  let rewardDeadEndsAssigned = 0;
  const openingSizes = [];
  const boundarySizes = [];
  const deadEndRatios = [];
  const unrewardedDeadEndRatios = [];
  const articulationCounts = [];
  const anchorBridgeCounts = [];
  const corridorLengths = [];
  const hopStretches = [];
  const euclideanStretches = [];
  const sharedSegmentRatios = [];
  const routeRiskTierDeltas = [];
  const maximumCombatGates = [];
  const lowerRiskDominanceCounts = [];
  const rewardGateDeltas = [];
  const reviewBandCrossingCounts = [];
  const warningCounts = new Map();
  const activity = new Map();
  const failures = [];
  const reproductions = [];
  const diagnosticOutliers = {
    openingSafeComponent: null,
    openingTier1Boundary: null,
    minimumCombatGate: null,
    rewardSiteGateDelta: null,
    deadEndRatio: null,
    unrewardedDeadEndRatio: null,
    articulationAnchorSeparators: null,
    anchorSeparatingBridges: null,
    singleChoiceCorridor: null,
    hopStretch: null,
    euclideanStretch: null,
    routeSharedSegmentRatio: null,
    routeRiskSeparation: null,
    lowerRiskDominance: null,
    activityDensityDeviation: null,
    activityConditionalShareDeviation: null,
    reviewBandCrossing: null
  };
  const warningExamples = {};
  const replaceOutlier = (name, value, world, payload, direction = 'maximum') => {
    if (!Number.isFinite(value)) return;
    const current = diagnosticOutliers[name];
    if (current
        && (direction === 'maximum' ? current.value >= value : current.value <= value)) {
      return;
    }
    diagnosticOutliers[name] = {
      value,
      seed: world.metadata.worldSeed,
      generatorVersion: world.metadata.generatorVersion,
      randomStreamVersion: world.metadata.randomStreamVersion,
      generationAttempt: world.metadata.generationAttempt,
      outputHash: world.metadata.outputHash,
      routeManifestHash: world.metadata.routeManifestHash,
      payload
    };
  };

  for (let seed = startSeed; seed <= endSeed; seed++) {
    try {
      const world = quietAssembly(seed);
      nodeCounts.push(world.nodes.length);
      connectionCounts.push(world.connections.length);
      const degreeByNodeKey = new Map(world.nodes.map((node) => [node.nodeKey, 0]));
      for (const connection of world.connections) {
        degreeByNodeKey.set(
          connection.fromNodeKey,
          (degreeByNodeKey.get(connection.fromNodeKey) ?? 0) + 1
        );
        degreeByNodeKey.set(
          connection.toNodeKey,
          (degreeByNodeKey.get(connection.toNodeKey) ?? 0) + 1
        );
      }
      const assignedTerminators = world.nodes.filter((node) => node.isTerminator);
      const assigned = assignedTerminators.length;
      const actualDeadEndsAssigned = assignedTerminators.filter((node) =>
        degreeByNodeKey.get(node.nodeKey) === 1
      ).length;
      rewardSitesAssigned += assigned;
      rewardDeadEndsAssigned += actualDeadEndsAssigned;
      deadEndShares.push(assigned === 0 ? 0 : actualDeadEndsAssigned / assigned);
      for (const opening of world.validation.metrics.openingComponents) {
        openingSizes.push(opening.safeComponentSize);
        boundarySizes.push(opening.boundarySize);
        replaceOutlier(
          'openingSafeComponent',
          opening.safeComponentSize,
          world,
          { castleNodeKey: opening.castleNodeKey }
        );
        replaceOutlier(
          'openingTier1Boundary',
          opening.boundarySize,
          world,
          { castleNodeKey: opening.castleNodeKey },
          'minimum'
        );
      }
      const quality = world.validation.metrics.graphQuality;
      deadEndRatios.push(quality.deadEndRatio);
      unrewardedDeadEndRatios.push(quality.unrewardedDeadEndRatio);
      replaceOutlier('deadEndRatio', quality.deadEndRatio, world, {
        degreeDistribution: quality.degreeDistribution
      });
      replaceOutlier('unrewardedDeadEndRatio', quality.unrewardedDeadEndRatio, world, {
        degreeDistribution: quality.degreeDistribution
      });
      articulationCounts.push(quality.articulationAnchorSeparators.length);
      anchorBridgeCounts.push(quality.anchorSeparatingBridges.length);
      replaceOutlier(
        'articulationAnchorSeparators',
        quality.articulationAnchorSeparators.length,
        world,
        { nodeKeys: quality.articulationAnchorSeparators }
      );
      replaceOutlier(
        'anchorSeparatingBridges',
        quality.anchorSeparatingBridges.length,
        world,
        { edgeNodeKeys: quality.anchorSeparatingBridges }
      );
      corridorLengths.push(quality.longestSingleChoiceCorridor);
      replaceOutlier(
        'singleChoiceCorridor',
        quality.longestSingleChoiceCorridor,
        world,
        { nodeKeys: quality.longestSingleChoiceCorridorPath }
      );
      hopStretches.push(...quality.graphStretch.map((entry) => entry.hopStretch));
      euclideanStretches.push(...quality.graphStretch
        .map((entry) => entry.euclideanStretch)
        .filter(Number.isFinite));
      lowerRiskDominanceCounts.push(quality.lowerRiskDominanceCount);
      sharedSegmentRatios.push(
        ...quality.routeAlternatives.map((route) => route.sharedSegmentRatio)
      );
      routeRiskTierDeltas.push(
        ...quality.routeAlternatives
          .map((route) => route.riskTierDelta)
          .filter(Number.isFinite)
      );
      reviewBandCrossingCounts.push(quality.reviewBandCrossings.length);
      for (const gates of quality.minimumCombatGates) {
        for (const [anchorKind, range] of Object.entries(gates)) {
          if (anchorKind === 'castleNodeKey' || !Number.isFinite(range.maximum)) continue;
          maximumCombatGates.push(range.maximum);
          replaceOutlier(
            'minimumCombatGate',
            range.maximum,
            world,
            { castleNodeKey: gates.castleNodeKey, anchorKind }
          );
        }
      }
      for (const stretch of quality.graphStretch) {
        const payload = {
          fromNodeKey: stretch.fromNodeKey,
          toNodeKey: stretch.toNodeKey
        };
        replaceOutlier('hopStretch', stretch.hopStretch, world, payload);
        replaceOutlier('euclideanStretch', stretch.euclideanStretch, world, payload);
      }
      for (const route of quality.routeAlternatives) {
        replaceOutlier(
          'routeSharedSegmentRatio',
          route.sharedSegmentRatio,
          world,
          {
            routePairKey: route.routePairKey,
            tradeSegmentCount: route.tradeSegmentCount,
            wildernessSegmentCount: route.wildernessSegmentCount
          }
        );
        replaceOutlier(
          'routeRiskSeparation',
          route.riskTierDelta,
          world,
          {
            routePairKey: route.routePairKey,
            tradeMaximumTier: route.tradeMaximumTier,
            wildernessMinimumTier: route.wildernessMinimumTier
          },
          'minimum'
        );
        if (route.lowerRiskDominance) {
          replaceOutlier(
            'lowerRiskDominance',
            1,
            world,
            { routePairKey: route.routePairKey }
          );
        }
      }
      for (const delta of quality.rewardSiteGateDeltas) {
        rewardGateDeltas.push(delta.minimumDelta);
        replaceOutlier(
          'rewardSiteGateDelta',
          delta.minimumDelta,
          world,
          {
            nodeKey: delta.nodeKey,
            maximumDelta: delta.maximumDelta,
            gateVector: delta.gateVector ?? null
          },
          'minimum'
        );
      }
      for (const crossing of quality.reviewBandCrossings) {
        replaceOutlier(
          'reviewBandCrossing',
          crossing.value / crossing.upper,
          world,
          crossing
        );
      }
      for (const warning of world.validation.warnings) {
        warningCounts.set(warning.code, (warningCounts.get(warning.code) ?? 0) + 1);
        warningExamples[warning.code] ??= {
          seed: world.metadata.worldSeed,
          generatorVersion: world.metadata.generatorVersion,
          randomStreamVersion: world.metadata.randomStreamVersion,
          generationAttempt: world.metadata.generationAttempt,
          outputHash: world.metadata.outputHash,
          routeManifestHash: world.metadata.routeManifestHash,
          payload: warning
        };
      }
      for (const profile of world.validation.metrics.activityProfiles) {
        const aggregate = activity.get(profile.race) ?? {
          total: 0,
          regionalNodeCount: 0,
          counts: { fishing_spot: 0, merchant_caravan: 0, ruins: 0 },
          configuredShares: profile.configuredShares,
          configuredDensityRange: profile.configuredDensityRange
        };
        aggregate.total += profile.total;
        aggregate.regionalNodeCount += profile.regionalNodeCount;
        for (const type of Object.keys(aggregate.counts)) {
          aggregate.counts[type] += profile.counts[type] ?? 0;
        }
        activity.set(profile.race, aggregate);
        const densityMidpoint = (
          profile.configuredDensityRange.min + profile.configuredDensityRange.max
        ) / 2;
        replaceOutlier(
          'activityDensityDeviation',
          Math.abs(profile.density - densityMidpoint),
          world,
          {
            regionId: profile.regionId,
            race: profile.race,
            density: profile.density,
            configuredDensityRange: profile.configuredDensityRange
          }
        );
        for (const [type, configuredShare] of Object.entries(profile.configuredShares)) {
          const observedShare = profile.total === 0
            ? 0
            : (profile.counts[type] ?? 0) / profile.total;
          replaceOutlier(
            'activityConditionalShareDeviation',
            Math.abs(observedShare - configuredShare),
            world,
            {
              regionId: profile.regionId,
              race: profile.race,
              nodeType: type,
              configuredShare,
              observedShare,
              activityDrawCount: profile.total
            }
          );
        }
      }
      if (!world.validation.valid) {
        failures.push({ seed, errors: world.validation.errors });
      }
      if (seed === startSeed || seed === endSeed) {
        reproductions.push({ seed, ...world.metadata });
      }
    } catch (error) {
      failures.push({ seed, error: error.message });
    }
  }

  const activityProfiles = Object.fromEntries(
    [...activity.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([race, value]) => [
      race,
      {
        ...value,
        density: Number((value.total / value.regionalNodeCount).toFixed(6)),
        observedShares: Object.fromEntries(Object.entries(value.counts).map(([type, count]) => [
          type,
          Number((value.total === 0 ? 0 : count / value.total).toFixed(6))
        ])),
        maximumAbsoluteDeviation: Number(Math.max(...Object.entries(value.counts).map(
          ([type, count]) => Math.abs(
            (value.total === 0 ? 0 : count / value.total) - value.configuredShares[type]
          )
        )).toFixed(6))
      }
    ])
  );
  const activityTotal = [...activity.values()]
    .reduce((total, profile) => total + profile.total, 0);
  const regionalNodeTotal = [...activity.values()]
    .reduce((total, profile) => total + profile.regionalNodeCount, 0);
  const activityDensity = regionalNodeTotal === 0 ? 0 : activityTotal / regionalNodeTotal;
  const rewardDeadEndAggregateShare = rewardSitesAssigned === 0
    ? 0
    : rewardDeadEndsAssigned / rewardSitesAssigned;
  if (endSeed - startSeed + 1 >= 500) {
    for (const [race, profile] of Object.entries(activityProfiles)) {
      if (profile.maximumAbsoluteDeviation > 0.05) {
        failures.push({
          scope: 'activity-profile',
          race,
          maximumAbsoluteDeviation: profile.maximumAbsoluteDeviation,
          threshold: 0.05
        });
      }
      if (
        profile.density < NODE_DISTRIBUTION.ACTIVITY_PERCENT.min
        || profile.density > NODE_DISTRIBUTION.ACTIVITY_PERCENT.max
      ) {
        failures.push({
          scope: 'activity-density',
          race,
          density: profile.density,
          configuredRange: NODE_DISTRIBUTION.ACTIVITY_PERCENT
        });
      }
    }
    if (
      activityDensity < NODE_DISTRIBUTION.ACTIVITY_PERCENT.min
      || activityDensity > NODE_DISTRIBUTION.ACTIVITY_PERCENT.max
    ) {
      failures.push({
        scope: 'total-activity-density',
        density: Number(activityDensity.toFixed(6)),
        configuredRange: NODE_DISTRIBUTION.ACTIVITY_PERCENT
      });
    }
  }
  if (endSeed - startSeed + 1 >= 5000) {
    const acceptanceRange = { min: 0.10, max: 0.20 };
    if (
      rewardDeadEndAggregateShare < acceptanceRange.min
      || rewardDeadEndAggregateShare > acceptanceRange.max
    ) {
      failures.push({
        scope: 'reward-dead-end-share',
        share: Number(rewardDeadEndAggregateShare.toFixed(6)),
        target: PHASE6_CONFIG.TERMINATOR_DEAD_END_RATIO,
        acceptanceRange
      });
    }
  }

  return {
    schemaVersion: 3,
    range: { startSeed, endSeed, count: endSeed - startSeed + 1 },
    failures,
    aggregate: {
      nodeCount: summary(nodeCounts),
      connectionCount: summary(connectionCounts),
      openingSafeComponentSize: summary(openingSizes),
      openingTier1BoundarySize: summary(boundarySizes),
      rewardDeadEndShare: {
        ...summary(deadEndShares.map((value) => Number(value.toFixed(6)))),
        aggregate: Number(rewardDeadEndAggregateShare.toFixed(6)),
        target: PHASE6_CONFIG.TERMINATOR_DEAD_END_RATIO,
        acceptanceRange: { min: 0.10, max: 0.20 }
      },
      activityDensity: {
        observed: Number(activityDensity.toFixed(6)),
        activityNodeCount: activityTotal,
        regionalNodeCount: regionalNodeTotal,
        configuredRange: NODE_DISTRIBUTION.ACTIVITY_PERCENT
      },
      graphQuality: {
        deadEndRatio: summary(deadEndRatios.map((value) => Number(value.toFixed(6)))),
        unrewardedDeadEndRatio: summary(
          unrewardedDeadEndRatios.map((value) => Number(value.toFixed(6)))
        ),
        articulationAnchorSeparatorCount: summary(articulationCounts),
        anchorSeparatingBridgeCount: summary(anchorBridgeCounts),
        longestSingleChoiceCorridor: summary(corridorLengths),
        hopStretch: summary(hopStretches.map((value) => Number(value.toFixed(6)))),
        euclideanStretch: summary(
          euclideanStretches.map((value) => Number(value.toFixed(6)))
        ),
        maximumCombatGates: summary(maximumCombatGates),
        routeSharedSegmentRatio: summary(
          sharedSegmentRatios.map((value) => Number(value.toFixed(6)))
        ),
        routeRiskTierDelta: summary(routeRiskTierDeltas),
        lowerRiskDominanceCount: summary(lowerRiskDominanceCounts),
        rewardSiteMinimumGateDelta: summary(rewardGateDeltas),
        reviewBandCrossingCount: summary(reviewBandCrossingCounts)
      },
      warningCounts: Object.fromEntries([...warningCounts.entries()].sort()),
      warningExamples: Object.fromEntries(
        Object.entries(warningExamples).sort(([left], [right]) => left.localeCompare(right))
      ),
      activityProfiles
    },
    diagnosticOutliers,
    reproductions
  };
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const startSeed = integerFlag('start', 1);
  const endSeed = integerFlag('end', 500);
  const report = generateCorpusReport(startSeed, endSeed);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.failures.length > 0) process.exitCode = 1;
}
