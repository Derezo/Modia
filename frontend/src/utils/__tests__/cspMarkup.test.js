import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = fileURLToPath(new URL('../../../', import.meta.url));
const sourceRoot = join(frontendRoot, 'src');
const indexPath = join(frontendRoot, 'index.html');

function listSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listSourceFiles(path) : [path];
  });
}

function parseDirectives(csp) {
  return Object.fromEntries(csp.split(';').map(part => {
    const [name, ...sources] = part.trim().split(/\s+/);
    return [name, sources];
  }));
}

describe('CSP-compatible markup', () => {
  it('contains no inline event-handler attributes', () => {
    const files = [
      indexPath,
      ...listSourceFiles(sourceRoot).filter(path =>
        ['.js', '.html'].includes(extname(path)) &&
        !path.split(sep).includes('__tests__')
      )
    ];
    const violations = [];

    for (const path of files) {
      const source = readFileSync(path, 'utf8');
      // Limit the match to tag-shaped markup so ordinary JavaScript
      // properties such as `image.onerror = ...` remain valid.
      const inlineHandler = /<[a-z][^>]*\son[a-z]+\s*=/gis;
      if (inlineHandler.test(source)) {
        violations.push(path.slice(frontendRoot.length + 1));
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Inline event handlers violate script-src-attr: ${violations.join(', ')}`
    );
  });

  it('keeps scripts strict while allowing the configured font stylesheet', () => {
    const html = readFileSync(indexPath, 'utf8');
    const csp = html.match(
      /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i
    )?.[1];
    assert.ok(csp, 'frontend/index.html must define a CSP');

    const directives = parseDirectives(csp);

    assert.deepEqual(directives['script-src'], ["'self'"]);
    assert.ok(directives['style-src'].includes('https://fonts.googleapis.com'));
    assert.ok(directives['font-src'].includes('https://fonts.gstatic.com'));
  });
});
