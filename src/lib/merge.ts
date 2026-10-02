// Merge data/releases.json (generated) with data/curated.yaml (hand-maintained) into one row per
// React Native minor. Used by the page, /matrix.json, /feed.xml and the tests.

import { parse } from 'yaml';
import type {
  CuratedEntry,
  CuratedField,
  CuratedFile,
  ExpoSdk,
  ReleaseMinor,
  ReleasesFile,
  Sourced,
  StatusChange,
  StoreDeadline,
  SupportStatus,
} from './types.ts';
import { compareMinor } from './versions.ts';

export type Origin = 'npm' | 'policy' | 'curated' | 'inherited';

export interface Cell<T = string | number> extends Sourced<T> {
  origin: Origin;
  /** Minor the curated value came from, when inherited. */
  from?: string;
}

export interface Row {
  minor: string;
  latest: string;
  released: string;
  latestReleased: string;
  status: SupportStatus;
  /** Latest stable minor. */
  current: boolean;
  statusSource: string;
  statusHistory: StatusChange[];
  react: Cell<string> | null;
  expo: Pick<ExpoSdk, 'sdk' | 'reactNative' | 'released' | 'source' | 'releaseNotes'>[];
  hermes: ReleaseMinor['hermes'];
  xcode: Cell<string> | null;
  ios: Cell<string> | null;
  minSdk: Cell<number> | null;
  compileSdk: Cell<number> | null;
  targetSdk: Cell<number> | null;
  node: Cell<string> | null;
  nodeDocumented: Sourced<string> | null;
  jdk: Cell<string> | null;
  gradle: Cell<string> | null;
  note: Sourced<string> | null;
  upgradeHelper: string | null;
  blog: string | null;
  releaseNotes: string;
}

export interface Matrix {
  generatedAt: string;
  latest: string;
  upcoming: ReleasesFile['upcoming'];
  rows: Row[];
  storeDeadlines: StoreDeadline[];
}

export const CURATED_FIELDS: CuratedField[] = ['xcode', 'ios', 'minSdk', 'compileSdk', 'targetSdk', 'node', 'jdk', 'gradle'];

export function parseCurated(yamlText: string): CuratedFile {
  const doc = parse(yamlText) as Partial<CuratedFile> | null;
  return {
    versions: [...(doc?.versions ?? [])].sort((a, b) => compareMinor(b.minor, a.minor)),
    store_deadlines: doc?.store_deadlines ?? [],
  };
}

const POLICY_HOSTS = ['reactwg/react-native-releases', 'reactnative.dev/releases'];
const originOf = (source: string): Origin => (POLICY_HOSTS.some((h) => source.includes(h)) ? 'policy' : 'npm');

/** The nearest curated entry at or below `minor` that sets `field`. */
function inheritedCurated(
  curated: CuratedEntry[],
  minor: string,
  field: CuratedField,
): { entry: CuratedEntry; value: Sourced<string | number> } | null {
  for (const entry of curated) {
    if (compareMinor(entry.minor, minor) > 0) continue;
    const value = entry[field];
    if (value) return { entry, value };
  }
  return null;
}

function resolve<T extends string | number>(
  release: ReleaseMinor,
  curated: CuratedEntry[],
  field: CuratedField,
): Cell<T> | null {
  const own = curated.find((c) => c.minor === release.minor)?.[field];
  if (own) return { ...(own as Sourced<T>), origin: 'curated' };
  const derived = release.toolchain[field];
  if (derived) return { ...(derived as Sourced<T>), origin: originOf(derived.source) };
  const inherited = inheritedCurated(curated, release.minor, field);
  if (inherited) return { ...(inherited.value as Sourced<T>), origin: 'inherited', from: inherited.entry.minor };
  return null;
}

export const upgradeHelperUrl = (from: string, to: string) =>
  `https://react-native-community.github.io/upgrade-helper/?from=${from}&to=${to}`;

export function merge(releases: ReleasesFile, curatedFile: CuratedFile): Matrix {
  const curated = curatedFile.versions;
  const minors = [...releases.minors].sort((a, b) => compareMinor(b.minor, a.minor));
  const rows = minors.map((r, i): Row => {
    const own = curated.find((c) => c.minor === r.minor);
    const previous = minors[i + 1];
    return {
      minor: r.minor,
      latest: r.latest,
      released: r.firstReleased,
      latestReleased: r.latestReleased,
      status: r.support.status,
      current: r.minor === releases.latest,
      statusSource: r.support.source,
      statusHistory: r.support.history,
      react: r.react ? { ...r.react, origin: 'npm' } : null,
      expo: releases.expo
        .filter((e) => e.minor === r.minor && !e.prerelease)
        .sort((a, b) => a.sdk - b.sdk)
        .map(({ sdk, reactNative, released, source, releaseNotes }) => ({ sdk, reactNative, released, source, releaseNotes })),
      hermes: r.hermes,
      xcode: resolve(r, curated, 'xcode'),
      ios: resolve(r, curated, 'ios'),
      minSdk: resolve(r, curated, 'minSdk'),
      compileSdk: resolve(r, curated, 'compileSdk'),
      targetSdk: resolve(r, curated, 'targetSdk'),
      node: resolve(r, curated, 'node'),
      nodeDocumented: r.toolchain.nodeDocumented ?? null,
      jdk: resolve(r, curated, 'jdk'),
      gradle: resolve(r, curated, 'gradle'),
      note: own?.note ?? null,
      upgradeHelper: own?.upgrade_helper ?? (previous ? upgradeHelperUrl(previous.latest, r.latest) : null),
      blog: r.blog,
      releaseNotes: r.releaseNotes,
    };
  });
  return {
    generatedAt: releases.generatedAt,
    latest: releases.latest,
    upcoming: releases.upcoming,
    rows,
    storeDeadlines: [...curatedFile.store_deadlines].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// ---- display helpers -------------------------------------------------------

/** "^22.13.0 || ^24.3.0 || >= 26.0.0" -> "22.13+ / 24.3+ / 26+" ; ">= 20.19.4" -> "20.19.4+" */
export function formatNode(range: string): string {
  return range
    .split('||')
    .map((part) => {
      const p = part.trim();
      const v = p.match(/(\d+(?:\.\d+)*)/)?.[1];
      if (!v) return p;
      const trimmed = v.replace(/\.0$/, '').replace(/\.0$/, '');
      if (/^[\^~]|>=?/.test(p)) return `${trimmed}+`;
      return trimmed;
    })
    .join(' / ');
}

/** "^19.1.4" -> "19.1.4"; "16.8.6" -> "16.8.6" */
export const formatReact = (range: string) => range.replace(/^[\^~]/, '');

export function expoLabel(row: Pick<Row, 'expo'>): string | null {
  if (row.expo.length === 0) return null;
  const first = row.expo[0]!.sdk;
  const last = row.expo.at(-1)!.sdk;
  return first === last ? `SDK ${first}` : `SDK ${first}–${last}`;
}

export const STATUS_LABEL: Record<SupportStatus, string> = {
  future: 'UPCOMING',
  active: 'SUPPORTED',
  'end-of-cycle': 'END OF CYCLE',
  unsupported: 'EOL',
};

export const statusLabel = (row: Pick<Row, 'status' | 'current'>) =>
  row.current && row.status === 'active' ? 'CURRENT' : STATUS_LABEL[row.status];

/** One-line answer for the lookup box. */
export function answerFor(row: Row): string {
  const parts = [`${row.minor} (${row.latest})`];
  const tail: string[] = [];
  const expo = expoLabel(row);
  tail.push(expo ? `Expo ${expo}` : 'no Expo SDK');
  if (row.react) tail.push(`React ${formatReact(row.react.value)}`);
  tail.push(row.hermes.default ? `Hermes ${row.hermes.label === 'V1 default' ? 'V1 bundled' : 'bundled'}` : 'Hermes opt-in');
  if (row.xcode && row.xcode.value !== 'latest') tail.push(`Xcode ≥ ${row.xcode.value}`);
  if (row.ios) tail.push(`iOS ≥ ${row.ios.value}`);
  if (row.targetSdk) tail.push(`Android targetSdk ${row.targetSdk.value}`);
  return `${parts[0]} → ${tail.join(', ')} · ${statusLabel(row)}`;
}
