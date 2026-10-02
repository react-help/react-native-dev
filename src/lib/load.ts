// Reads the two committed data files. Paths are relative to the repo root, which is the working
// directory for `astro build`, `npm test` and the refresh workflow.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { merge, parseCurated, type Matrix } from './merge.ts';
import type { CuratedFile, ReleasesFile } from './types.ts';

export const RELEASES_PATH = resolve(process.cwd(), 'data/releases.json');
export const CURATED_PATH = resolve(process.cwd(), 'data/curated.yaml');

export const loadReleases = (): ReleasesFile => JSON.parse(readFileSync(RELEASES_PATH, 'utf8')) as ReleasesFile;
export const loadCurated = (): CuratedFile => parseCurated(readFileSync(CURATED_PATH, 'utf8'));
export const loadMatrix = (): Matrix => merge(loadReleases(), loadCurated());
