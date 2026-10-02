import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCurated, loadMatrix, loadReleases } from '../src/lib/load.ts';
import { CURATED_FIELDS, answerFor } from '../src/lib/merge.ts';
import { compareMinor, parseMinorInput } from '../src/lib/versions.ts';
import type { Sourced } from '../src/lib/types.ts';

const isUrl = (s: unknown) => typeof s === 'string' && /^https:\/\/\S+$/.test(s);

const curated = loadCurated();
const releases = loadReleases();
const matrix = loadMatrix();

test('every curated value has an https source URL', () => {
  for (const entry of curated.versions) {
    assert.match(entry.minor, /^0\.\d+$/, `minor key ${JSON.stringify(entry.minor)} must be a quoted string like "0.81"`);
    for (const field of [...CURATED_FIELDS, 'note'] as const) {
      const v = entry[field] as Sourced<unknown> | undefined;
      if (!v) continue;
      assert.ok(v.value !== undefined && v.value !== '', `${entry.minor}.${field} has no value`);
      assert.ok(isUrl(v.source), `${entry.minor}.${field} is missing a source URL`);
      if (v.verified !== undefined) assert.equal(typeof v.verified, 'boolean', `${entry.minor}.${field}.verified must be a boolean`);
    }
    if (entry.upgrade_helper) assert.ok(isUrl(entry.upgrade_helper), `${entry.minor}.upgrade_helper must be a URL`);
  }
});

test('every store deadline has a date and source URL', () => {
  assert.ok(curated.store_deadlines.length > 0);
  for (const d of curated.store_deadlines) {
    assert.match(d.date, /^\d{4}-\d{2}-\d{2}$/, `${d.id} date`);
    assert.ok(isUrl(d.source), `${d.id} is missing a source URL`);
  }
});

test('every React Native minor in releases.json has at least an inherited curated row', () => {
  for (const m of releases.minors) {
    const covering = curated.versions.find((c) => compareMinor(c.minor, m.minor) <= 0);
    assert.ok(covering, `no curated entry at or below ${m.minor}`);
  }
});

test('curated entries refer to minors that exist', () => {
  const known = new Set(releases.minors.map((m) => m.minor));
  for (const entry of curated.versions) assert.ok(known.has(entry.minor), `curated entry ${entry.minor} has no release`);
});

test('every displayed cell carries a source URL', () => {
  for (const row of matrix.rows) {
    for (const key of ['react', 'xcode', 'ios', 'minSdk', 'compileSdk', 'targetSdk', 'node', 'jdk', 'gradle', 'note'] as const) {
      const cell = row[key];
      if (cell) assert.ok(isUrl(cell.source), `${row.minor}.${key} has no source`);
    }
    assert.ok(isUrl(row.hermes.source), `${row.minor}.hermes has no source`);
    assert.ok(isUrl(row.statusSource), `${row.minor}.status has no source`);
    for (const e of row.expo) assert.ok(isUrl(e.source), `${row.minor}.expo ${e.sdk} has no source`);
  }
});

test('releases.json is sane', () => {
  assert.ok(releases.minors.length >= 20, 'expected at least 20 minors since 0.60');
  assert.ok(releases.minors.some((m) => m.minor === '0.60'), '0.60 missing');
  assert.ok(releases.minors.some((m) => m.minor === releases.latest), 'latest minor missing');
  const supported = releases.minors.filter((m) => m.support.status !== 'unsupported');
  assert.ok(supported.length >= 1 && supported.length <= 4, `unexpected number of supported minors: ${supported.length}`);
  for (const m of releases.minors) {
    assert.match(m.latest, /^\d+\.\d+\.\d+$/);
    assert.ok(m.latest.startsWith(`${m.minor}.`));
    assert.match(m.firstReleased, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(m.react, `${m.minor} has no React version`);
    assert.ok(m.support.history.length > 0, `${m.minor} has no status history`);
  }
});

test('the latest three minors have complete rows and a lookup answer', () => {
  for (const row of matrix.rows.slice(0, 3)) {
    for (const key of ['react', 'xcode', 'ios', 'minSdk', 'compileSdk', 'targetSdk', 'node', 'jdk', 'gradle'] as const) {
      assert.ok(row[key], `${row.minor}.${key} is empty`);
    }
    const answer = answerFor(row);
    assert.ok(answer.startsWith(`${row.minor} (${row.latest}) →`), answer);
    assert.match(answer, /React \d/);
    assert.match(answer, /Xcode ≥ \d/);
    assert.match(answer, /targetSdk \d+/);
  }
});

test('lookup input parsing', () => {
  assert.equal(parseMinorInput('0.81'), '0.81');
  assert.equal(parseMinorInput('81'), '0.81');
  assert.equal(parseMinorInput('v0.81.4'), '0.81');
  assert.equal(parseMinorInput('react-native@0.76.9'), '0.76');
  assert.equal(parseMinorInput('hello'), null);
});
