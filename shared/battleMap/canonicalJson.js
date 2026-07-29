/**
 * RFC 8785 JSON Canonicalization Scheme serialization.
 *
 * This implementation deliberately accepts a narrower input domain than
 * JSON.stringify: only JSON primitives, dense arrays, and plain objects.
 * Undefined, non-finite numbers, bigint, symbols, functions, sparse arrays,
 * custom prototypes, cycles, and lone Unicode surrogates are rejected.
 */

function assertUnicodeScalarString(value, path) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError(`${path} contains a lone high surrogate`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(`${path} contains a lone low surrogate`);
    }
  }
}

function serialize(value, path, ancestors) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      assertUnicodeScalarString(value, path);
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`${path} must be finite`);
      return Object.is(value, -0) ? '0' : JSON.stringify(value);
    case 'undefined':
    case 'bigint':
    case 'symbol':
    case 'function':
      throw new TypeError(`${path} has unsupported type ${typeof value}`);
    case 'object':
      break;
    default:
      throw new TypeError(`${path} has unsupported type ${typeof value}`);
  }

  if (ancestors.has(value)) throw new TypeError(`${path} contains a cycle`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (const key of Reflect.ownKeys(value)) {
        if (key === 'length') continue;
        if (typeof key === 'symbol' || !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
          throw new TypeError(`${path} has an unsupported array property`);
        }
      }
      const output = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new TypeError(`${path}[${index}] is a sparse array entry`);
        }
        output.push(serialize(value[index], `${path}[${index}]`, ancestors));
      }
      return `[${output.join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must be a plain object`);
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some(key => typeof key === 'symbol')) {
      throw new TypeError(`${path} has an unsupported symbol key`);
    }
    if (ownKeys.some(key => !Object.prototype.propertyIsEnumerable.call(value, key))) {
      throw new TypeError(`${path} has an unsupported non-enumerable property`);
    }
    const keys = ownKeys.sort();
    const output = [];
    for (const key of keys) {
      assertUnicodeScalarString(key, `${path} key`);
      output.push(`${JSON.stringify(key)}:${serialize(value[key], `${path}.${key}`, ancestors)}`);
    }
    return `{${output.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalizeJson(value) {
  return serialize(value, '$', new Set());
}

export function canonicalJsonBytes(value) {
  return new TextEncoder().encode(canonicalizeJson(value));
}

/**
 * JSON parser that rejects duplicate object keys before a JavaScript object can
 * overwrite them. It implements the JSON grammar and then subjects the result
 * to the same finite-number and Unicode-scalar restrictions as canonicalizing.
 */
export function parseJsonRejectDuplicateKeys(source) {
  if (typeof source !== 'string') throw new TypeError('JSON source must be a string');
  let cursor = 0;

  const fail = message => {
    throw new SyntaxError(`${message} at offset ${cursor}`);
  };
  const whitespace = () => {
    while (cursor < source.length && /[\t\n\r ]/.test(source[cursor])) cursor += 1;
  };
  const parseString = () => {
    if (source[cursor] !== '"') fail('Expected string');
    const start = cursor;
    cursor += 1;
    while (cursor < source.length) {
      const code = source.charCodeAt(cursor);
      if (code === 0x22) {
        cursor += 1;
        const value = JSON.parse(source.slice(start, cursor));
        assertUnicodeScalarString(value, 'JSON string');
        return value;
      }
      if (code < 0x20) fail('Unescaped control character');
      if (code === 0x5c) {
        cursor += 1;
        const escape = source[cursor];
        if (!'"\\/bfnrtu'.includes(escape)) fail('Invalid string escape');
        if (escape === 'u') {
          const hex = source.slice(cursor + 1, cursor + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Invalid Unicode escape');
          cursor += 4;
        }
      }
      cursor += 1;
    }
    fail('Unterminated string');
  };
  const parseNumber = () => {
    const match = source.slice(cursor).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) fail('Invalid number');
    cursor += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) fail('Number must be finite');
    return value;
  };
  const parseArray = () => {
    const result = [];
    cursor += 1;
    whitespace();
    if (source[cursor] === ']') {
      cursor += 1;
      return result;
    }
    while (cursor < source.length) {
      result.push(parseValue());
      whitespace();
      if (source[cursor] === ']') {
        cursor += 1;
        return result;
      }
      if (source[cursor] !== ',') fail('Expected comma or closing bracket');
      cursor += 1;
      whitespace();
    }
    fail('Unterminated array');
  };
  const parseObject = () => {
    const result = {};
    const keys = new Set();
    cursor += 1;
    whitespace();
    if (source[cursor] === '}') {
      cursor += 1;
      return result;
    }
    while (cursor < source.length) {
      const key = parseString();
      if (keys.has(key)) fail(`Duplicate object key ${JSON.stringify(key)}`);
      keys.add(key);
      whitespace();
      if (source[cursor] !== ':') fail('Expected colon');
      cursor += 1;
      result[key] = parseValue();
      whitespace();
      if (source[cursor] === '}') {
        cursor += 1;
        return result;
      }
      if (source[cursor] !== ',') fail('Expected comma or closing brace');
      cursor += 1;
      whitespace();
    }
    fail('Unterminated object');
  };
  const parseValue = () => {
    whitespace();
    const character = source[cursor];
    if (character === '"') return parseString();
    if (character === '[') return parseArray();
    if (character === '{') return parseObject();
    if (source.startsWith('true', cursor)) {
      cursor += 4;
      return true;
    }
    if (source.startsWith('false', cursor)) {
      cursor += 5;
      return false;
    }
    if (source.startsWith('null', cursor)) {
      cursor += 4;
      return null;
    }
    if (character === '-' || (character >= '0' && character <= '9')) return parseNumber();
    fail('Expected JSON value');
  };

  const result = parseValue();
  whitespace();
  if (cursor !== source.length) fail('Unexpected trailing content');
  // Exercise the canonical input validator as a final defense.
  canonicalizeJson(result);
  return result;
}

export function deepCloneJsonValue(value) {
  return parseJsonRejectDuplicateKeys(canonicalizeJson(value));
}

export function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
