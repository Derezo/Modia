import {
  createNamedRandom,
  deriveStreamSeed
} from './Determinism.js';
import { V2_CONTEXT_KEYS } from './V2Context.js';

const VALID_CONTEXT_KEYS = new Set(V2_CONTEXT_KEYS);

function normalizedKeyList(value, field, stageId) {
  if (!Array.isArray(value)) {
    throw new TypeError(`V2 stage ${stageId} ${field} must be an array`);
  }
  const keys = [...new Set(value)];
  for (const key of keys) {
    if (!VALID_CONTEXT_KEYS.has(key)) {
      throw new TypeError(`V2 stage ${stageId} declares unknown ${field} key: ${key}`);
    }
  }
  return Object.freeze(keys);
}

export class CandidateStageError extends Error {
  constructor(stageId, code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'CandidateStageError';
    this.stageId = stageId;
    this.code = code;
  }
}

export class V2StageRegistry {
  constructor() {
    this._stages = new Map();
  }

  register(definition) {
    const id = definition?.id;
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) {
      throw new TypeError('V2 stage id must match /^[a-z][a-z0-9-]*$/');
    }
    if (this._stages.has(id)) throw new Error(`Duplicate V2 stage id: ${id}`);
    if (typeof definition.run !== 'function') {
      throw new TypeError(`V2 stage ${id} must provide run(context, parameters, tools)`);
    }
    if (typeof definition.stream !== 'string' || definition.stream.length === 0) {
      throw new TypeError(`V2 stage ${id} must declare a deterministic stream`);
    }
    const stage = Object.freeze({
      id,
      inputs: normalizedKeyList(definition.inputs ?? [], 'inputs', id),
      outputs: normalizedKeyList(definition.outputs ?? [], 'outputs', id),
      required: definition.required !== false,
      stream: definition.stream,
      run: definition.run
    });
    this._stages.set(id, stage);
    return stage;
  }

  get(id) {
    const stage = this._stages.get(id);
    if (!stage) throw new Error(`Unknown V2 stage: ${id}`);
    return stage;
  }

  list() {
    return Object.freeze([...this._stages.values()]);
  }
}

function normalizeStageResult(stage, result) {
  if (result === undefined || result === null) return {};
  if (typeof result !== 'object' || Array.isArray(result)) {
    throw new TypeError(`V2 stage ${stage.id} must return an output object`);
  }
  for (const key of Object.keys(result)) {
    if (!stage.outputs.includes(key)) {
      throw new TypeError(`V2 stage ${stage.id} returned undeclared output: ${key}`);
    }
  }
  return result;
}

/**
 * Execute an ordered candidate pipeline. Required failures abort the attempt;
 * optional failures are recorded and may only be tolerated when no downstream
 * required stage needs their absent outputs.
 */
export async function executeStagePipeline({
  registry,
  stageIds,
  context,
  parametersByStage = {}
}) {
  if (!(registry instanceof V2StageRegistry)) {
    throw new TypeError('registry must be a V2StageRegistry');
  }
  if (!Array.isArray(stageIds)) throw new TypeError('stageIds must be an array');

  for (const stageId of stageIds) {
    const stage = registry.get(stageId);
    const missingInputs = stage.inputs.filter(key => !context.has(key));
    if (missingInputs.length > 0) {
      const message = `Stage ${stage.id} is missing inputs: ${missingInputs.join(', ')}`;
      context.recordStageEvent({
        stageId: stage.id,
        status: stage.required ? 'failed' : 'omitted',
        code: 'MISSING_INPUT',
        missingInputs
      });
      if (stage.required) {
        throw new CandidateStageError(stage.id, 'MISSING_INPUT', message);
      }
      continue;
    }

    const streamSeed = deriveStreamSeed(context.attemptSeed, stage.stream);
    const tools = Object.freeze({
      streamName: stage.stream,
      streamSeed,
      random: createNamedRandom(context.attemptSeed, stage.stream)
    });

    try {
      const result = normalizeStageResult(
        stage,
        await stage.run(context, parametersByStage[stage.id] ?? {}, tools)
      );
      const missingOutputs = stage.outputs.filter(key => !(key in result));
      if (stage.required && missingOutputs.length > 0) {
        throw new CandidateStageError(
          stage.id,
          'MISSING_OUTPUT',
          `Stage ${stage.id} did not return outputs: ${missingOutputs.join(', ')}`
        );
      }
      for (const [key, value] of Object.entries(result)) {
        context.publish(key, value, stage.id);
      }
      context.recordStageEvent({
        stageId: stage.id,
        status: missingOutputs.length === 0 ? 'completed' : 'completed-partial',
        stream: stage.stream,
        streamSeed,
        outputs: Object.keys(result),
        omittedOutputs: missingOutputs
      });
    } catch (error) {
      if (error instanceof CandidateStageError && error.stageId === stage.id) {
        context.recordStageEvent({
          stageId: stage.id,
          status: 'failed',
          code: error.code,
          message: error.message
        });
        throw error;
      }
      context.recordStageEvent({
        stageId: stage.id,
        status: stage.required ? 'failed' : 'omitted',
        code: 'STAGE_ERROR',
        message: error?.message ?? String(error)
      });
      if (stage.required) {
        throw new CandidateStageError(
          stage.id,
          'STAGE_ERROR',
          `Required V2 stage ${stage.id} failed: ${error?.message ?? String(error)}`,
          error
        );
      }
    }
  }

  return context;
}

export function createStageRegistry() {
  return new V2StageRegistry();
}

