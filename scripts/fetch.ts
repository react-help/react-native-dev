// Regenerates data/releases.json from public sources. Run by the refresh workflow, never by Netlify.
//
//   node scripts/fetch.ts          incremental: only re-reads toolchain files for new patches
//   node scripts/fetch.ts --full   re-read everything
//
// Resilience contract: any failure (one version, one source, the whole network) keeps the last-good
// value from the previous releases.json and logs a warning. The script always exits 0 unless the
// output itself could not be written.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type {
  ExpoSdk,
  Hermes,
  ReleaseMinor,
  ReleasesFile,
  Sourced,
  StatusChange,
  SupportStatus,
  Toolchain,
} from '../src/lib/types.ts';
import { compareDotted, compareMinor, minorNum, minorOf, isStable, patchNum } from '../src/lib/versions.ts';

const OUT = fileURLToPath(new URL('../data/releases.json', import.meta.url));
const FULL = process.argv.includes('--full');
const FIRST_MINOR = 60;
const FIRST_EXPO_SDK = 36; // first SDK on RN >= 0.60

const UA = 'react-native.dev-matrix/1.0 (+https://github.com/react-help/react-native-dev)';
const NPM = 'https://registry.npmjs.org';
const CDN = 'https://cdn.jsdelivr.net/npm';
const RN_SITE_RAW = 'https://raw.githubusercontent.com/react/react-native-website/HEAD';
const RELEASES_TABLE_RAW = `${RN_SITE_RAW}/website/src/components/releases/_releases-table.md`;
const RELEASES_PAGE = 'https://reactnative.dev/releases';
const SUPPORT_DOC_RAW = 'https://raw.githubusercontent.com/reactwg/react-native-releases/HEAD/docs/support.md';
const SUPPORT_DOC = 'https://github.com/reactwg/react-native-releases/blob/main/docs/support.md#external-dependencies-supported';
const EXPO_VERSIONS_API = 'https://api.expo.dev/v2/versions';

// Fixed historical facts used by the Hermes rule.
const HERMES_DEFAULT_FROM = 70;
const HERMES_DEFAULT_SOURCE = 'https://reactnative.dev/blog/2022/09/05/version-070#hermes-as-default-engine';
const HERMES_V1_FROM = 84;
const HERMES_V1_SOURCE = 'https://reactnative.dev/blog/2026/02/11/react-native-0.84#hermes-v1-as-default';

const warnings: string[] = [];
const warn = (msg: string) => {
  warnings.push(msg);
  console.warn(`warn: ${msg}`);
};

// ---- HTTP ------------------------------------------------------------------

class NotFound extends Error {}

async function get(url: string, accept = '*/*'): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 404) throw new NotFound(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      if (err instanceof NotFound) throw err;
      lastError = err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function getJson<T>(url: string): Promise<T> {
  return JSON.parse(await get(url, 'application/json')) as T;
}

/** Fetch a file that may legitimately not exist. `null` = 404, throws on network/server errors. */
async function optional(url: string): Promise<string | null> {
  try {
    return await get(url);
  } catch (err) {
    if (err instanceof NotFound) return null;
    throw err;
  }
}

/** Run with limited parallelism so we stay polite to the CDN. */
async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---- npm -------------------------------------------------------------------

interface Packument {
  'dist-tags': Record<string, string>;
  time: Record<string, string>;
  versions: Record<string, {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    engines?: Record<string, string>;
  }>;
}

const day = (iso: string | undefined) => (iso ? iso.slice(0, 10) : '');

/** Group stable versions by minor and pick the highest patch. */
function latestPatches(p: Packument, keyOf: (v: string) => string): Map<string, string> {
  const out = new Map<string, string>();
  for (const v of Object.keys(p.versions)) {
    if (!isStable(v)) continue;
    const k = keyOf(v);
    const cur = out.get(k);
    if (!cur || patchNum(v) > patchNum(cur)) out.set(k, v);
  }
  return out;
}

// ---- release crew tables ---------------------------------------------------

/** Parse a GitHub-flavoured markdown table into rows of trimmed cells (header row excluded). */
function mdTable(md: string, headerStartsWith: string): string[][] {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.trim().startsWith('|') && l.includes(headerStartsWith));
  if (start < 0) return [];
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.trim().startsWith('|')) break;
    rows.push(line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
  }
  return rows;
}

interface PolicyRow {
  status: SupportStatus;
  releaseDate: string | null;
  blog: string | null;
}

const STATUS_WORDS: Record<string, SupportStatus> = {
  future: 'future',
  active: 'active',
  'end of cycle': 'end-of-cycle',
  unsupported: 'unsupported',
};

async function fetchPolicyTable(): Promise<Map<string, PolicyRow> | null> {
  try {
    const md = await get(RELEASES_TABLE_RAW);
    const out = new Map<string, PolicyRow>();
    for (const [version, , releaseDate, support, blog] of mdTable(md, 'Version')) {
      const minor = version?.match(/^(\d+\.\d+)/)?.[1];
      const status = STATUS_WORDS[(support ?? '').toLowerCase()];
      if (!minor || !status) continue;
      const href = blog?.match(/\]\(([^)]+)\)/)?.[1] ?? null;
      out.set(minor, {
        status,
        releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(releaseDate ?? '') ? releaseDate! : null,
        blog: href ? new URL(href, 'https://reactnative.dev').href : null,
      });
    }
    if (out.size === 0) throw new Error('releases table parsed to zero rows');
    return out;
  } catch (err) {
    warn(`support table unavailable (${(err as Error).message}); keeping last-good statuses`);
    return null;
  }
}

interface ExternalDeps {
  jdk?: string;
  xcode?: string;
  node?: string;
}

async function fetchExternalDeps(): Promise<Map<string, ExternalDeps> | null> {
  try {
    const md = await get(SUPPORT_DOC_RAW);
    const header = mdTable(md, 'Android SDK minimum');
    const out = new Map<string, ExternalDeps>();
    for (const [version, , jdk, xcode, , node] of header) {
      const minor = version?.match(/^(\d+\.\d+)/)?.[1];
      if (!minor) continue;
      out.set(minor, {
        jdk: jdk?.match(/(\d+)/)?.[1],
        xcode: xcode?.match(/^(\d+(?:\.\d+)*)/)?.[1],
        node: node?.match(/^(\d+(?:\.\d+)*)/)?.[1],
      });
    }
    if (out.size === 0) throw new Error('external dependencies table parsed to zero rows');
    return out;
  } catch (err) {
    warn(`external dependencies table unavailable (${(err as Error).message}); keeping last-good values`);
    return null;
  }
}

// ---- toolchain files inside the published packages -------------------------

const rubyReturn = (src: string | null, fn: string) =>
  src?.match(new RegExp(`def\\s+(?:self\\.)?${fn}\\s*\\n\\s*return\\s+['"]([\\d.]+)['"]`))?.[1];

const gradleExt = (src: string | null, key: string) =>
  src?.match(new RegExp(`\\b${key}\\s*=\\s*(\\d+)`))?.[1];

const tomlKey = (src: string | null, key: string) =>
  src?.match(new RegExp(`^${key}\\s*=\\s*"(\\d+)"`, 'm'))?.[1];

/**
 * Read iOS / Xcode / Android / Gradle values straight from files shipped in the npm tarballs.
 * Returns null when a network error means we could not finish (caller keeps last-good).
 */
async function readToolchainFiles(
  rnVersion: string,
  templateVersion: string | null,
): Promise<Toolchain | null> {
  const rn = `${CDN}/react-native@${rnVersion}`;
  const tpl = templateVersion
    ? `${CDN}/@react-native-community/template@${templateVersion}/template`
    : `${rn}/template`;
  const paths = {
    helpers: `${rn}/scripts/cocoapods/helpers.rb`,
    pods: `${rn}/scripts/react_native_pods.rb`,
    toml: `${rn}/gradle/libs.versions.toml`,
    buildGradle: `${tpl}/android/build.gradle`,
    wrapper: `${tpl}/android/gradle/wrapper/gradle-wrapper.properties`,
    podfile: `${tpl}/ios/Podfile`,
  };
  try {
    const entries = await Promise.all(
      Object.entries(paths).map(async ([k, url]) => [k, await optional(url)] as const),
    );
    const f = Object.fromEntries(entries) as Record<keyof typeof paths, string | null>;
    const tc: Toolchain = {};

    const iosFromHelpers = rubyReturn(f.helpers, 'min_ios_version_supported');
    const iosFromPods = rubyReturn(f.pods, 'min_ios_version_supported');
    const iosFromPodfile = f.podfile?.match(/platform\s+:ios,\s*['"]([\d.]+)['"]/)?.[1];
    if (iosFromHelpers) tc.ios = { value: iosFromHelpers, source: paths.helpers };
    else if (iosFromPods) tc.ios = { value: iosFromPods, source: paths.pods };
    else if (iosFromPodfile) tc.ios = { value: iosFromPodfile, source: paths.podfile };

    const xcode = rubyReturn(f.helpers, 'min_xcode_version_supported');
    if (xcode) tc.xcode = { value: xcode, source: paths.helpers };

    // The template's build.gradle is what a new app actually ships with; RN's own toml is the fallback.
    for (const [field, gradleKey, tomlName] of [
      ['minSdk', 'minSdkVersion', 'minSdk'],
      ['compileSdk', 'compileSdkVersion', 'compileSdk'],
      ['targetSdk', 'targetSdkVersion', 'targetSdk'],
    ] as const) {
      const fromTemplate = gradleExt(f.buildGradle, gradleKey);
      const fromToml = tomlKey(f.toml, tomlName);
      if (fromTemplate) tc[field] = { value: Number(fromTemplate), source: paths.buildGradle };
      else if (fromToml) tc[field] = { value: Number(fromToml), source: paths.toml };
    }

    const gradle = f.wrapper?.match(/gradle-([\d.]+)-(?:all|bin)\.zip/)?.[1];
    if (gradle) tc.gradle = { value: gradle, source: paths.wrapper };

    return tc;
  } catch (err) {
    warn(`toolchain files for react-native@${rnVersion}: ${(err as Error).message}`);
    return null;
  }
}

// ---- support history -------------------------------------------------------

const ORDER: SupportStatus[] = ['future', 'active', 'end-of-cycle', 'unsupported'];

/**
 * Back-fill a status history from the current rule (latest two minors active, third end-of-cycle,
 * older unsupported): a minor goes end-of-cycle when the minor two above it ships and unsupported
 * when the minor three above it ships. Dates are flagged as estimated.
 */
function backfillHistory(
  minor: string,
  current: SupportStatus,
  releaseDates: Map<string, string>,
  sortedMinors: string[],
): StatusChange[] {
  const i = sortedMinors.indexOf(minor);
  const at = (offset: number) => releaseDates.get(sortedMinors[i + offset] ?? '');
  const steps: [SupportStatus, string | undefined][] = [
    ['active', releaseDates.get(minor)],
    ['end-of-cycle', at(2)],
    ['unsupported', at(3)],
  ];
  const upTo = ORDER.indexOf(current);
  const out: StatusChange[] = [];
  for (const [status, since] of steps) {
    if (ORDER.indexOf(status) > upTo) break;
    if (since) out.push({ status, since, estimated: true });
  }
  return out;
}

function nextHistory(
  prev: StatusChange[] | undefined,
  current: SupportStatus,
  backfill: () => StatusChange[],
  today: string,
): StatusChange[] {
  if (!prev || prev.length === 0) return backfill();
  if (prev.at(-1)!.status === current) return prev;
  return [...prev, { status: current, since: today }];
}

// ---- Expo ------------------------------------------------------------------

interface ExpoApi {
  data?: { sdkVersions?: Record<string, { facebookReactNativeVersion?: string; releaseNoteUrl?: string }> };
  sdkVersions?: Record<string, { facebookReactNativeVersion?: string; releaseNoteUrl?: string }>;
}

async function fetchExpo(prev: ExpoSdk[]): Promise<ExpoSdk[]> {
  let pack: Packument;
  try {
    pack = await getJson<Packument>(`${NPM}/expo`);
  } catch (err) {
    warn(`expo packument unavailable (${(err as Error).message}); keeping last-good Expo data`);
    return prev;
  }
  let api: ExpoApi['sdkVersions'] = {};
  try {
    const j = await getJson<ExpoApi>(EXPO_VERSIONS_API);
    api = j.data?.sdkVersions ?? j.sdkVersions ?? {};
  } catch (err) {
    warn(`Expo versions API unavailable (${(err as Error).message}); release notes links may be stale`);
  }
  const prevBySdk = new Map(prev.map((e) => [e.sdk, e]));
  const latest = latestPatches(pack, (v) => v.split('.')[0]!);
  const sdks = [...latest.keys()].map(Number).filter((n) => n >= FIRST_EXPO_SDK).sort((a, b) => a - b);

  const results = await pool(sdks, 6, async (sdk): Promise<ExpoSdk | null> => {
    const version = latest.get(String(sdk))!;
    const old = prevBySdk.get(sdk);
    const apiEntry = api?.[`${sdk}.0.0`];
    const releaseNotes = apiEntry?.releaseNoteUrl ?? old?.releaseNotes ?? null;
    if (old && old.latest === version && !FULL) return { ...old, releaseNotes };

    const bnmUrl = `${CDN}/expo@${version}/bundledNativeModules.json`;
    let rnVersion: string | undefined;
    let source = bnmUrl;
    try {
      const bnm = await optional(bnmUrl);
      rnVersion = bnm ? (JSON.parse(bnm) as Record<string, string>)['react-native'] : undefined;
    } catch (err) {
      warn(`expo@${version} bundledNativeModules.json: ${(err as Error).message}`);
      if (old) return old;
    }
    if (!rnVersion && apiEntry?.facebookReactNativeVersion) {
      rnVersion = apiEntry.facebookReactNativeVersion;
      source = `${EXPO_VERSIONS_API}#sdkVersions.${sdk}.0.0`;
    }
    rnVersion = rnVersion?.replace(/^[~^]/, '');
    if (!rnVersion) {
      warn(`expo SDK ${sdk}: could not determine react-native version`);
      return old ?? null;
    }
    return {
      sdk,
      latest: version,
      released: day(pack.time[`${sdk}.0.0`] ?? pack.time[version]),
      reactNative: rnVersion,
      minor: minorOf(rnVersion),
      prerelease: !isStable(rnVersion),
      source,
      releaseNotes,
    };
  });
  return results.filter((r): r is ExpoSdk => r !== null).sort((a, b) => b.sdk - a.sdk);
}

// ---- main ------------------------------------------------------------------

async function loadPrevious(): Promise<ReleasesFile | null> {
  try {
    return JSON.parse(await readFile(OUT, 'utf8')) as ReleasesFile;
  } catch {
    return null;
  }
}

function hermesFor(minor: string, rnVersion: string, deps: Record<string, string>): Hermes {
  const n = minorNum(minor);
  const pkg = `${CDN}/react-native@${rnVersion}/package.json`;
  const compiler = deps['hermes-compiler'] ?? null;
  const engine = deps['hermes-engine'] ?? null;
  if (n >= HERMES_V1_FROM) return { default: true, label: 'V1 default', engine: null, compiler, source: HERMES_V1_SOURCE };
  if (n >= HERMES_DEFAULT_FROM) return { default: true, label: 'Default', engine: null, compiler, source: HERMES_DEFAULT_SOURCE };
  if (engine) return { default: false, label: 'Opt-in', engine, compiler: null, source: pkg };
  // 0.60: Hermes was opt-in on Android via a template flag, with no npm dependency declared by react-native.
  return { default: false, label: 'Opt-in', engine: null, compiler: null, source: 'https://reactnative.dev/blog/2019/07/17/hermes' };
}

async function main() {
  const prev = await loadPrevious();
  const prevByMinor = new Map(prev?.minors.map((m) => [m.minor, m]) ?? []);
  const today = new Date().toISOString().slice(0, 10);

  let rn: Packument;
  try {
    rn = await getJson<Packument>(`${NPM}/react-native`);
  } catch (err) {
    warn(`react-native packument unavailable (${(err as Error).message}); leaving releases.json untouched`);
    return;
  }

  let template: Packument | null = null;
  try {
    template = await getJson<Packument>(`${NPM}/@react-native-community/template`);
  } catch (err) {
    warn(`template packument unavailable (${(err as Error).message}); Gradle/Android values for new patches may be missing`);
  }
  const templateLatest = template ? latestPatches(template, minorOf) : new Map<string, string>();

  const [policy, externalDeps, expo] = await Promise.all([
    fetchPolicyTable(),
    fetchExternalDeps(),
    fetchExpo(prev?.expo ?? []),
  ]);

  const latestByMinor = latestPatches(rn, minorOf);
  const minors = [...latestByMinor.keys()].filter((m) => minorNum(m) >= FIRST_MINOR).sort(compareMinor);
  const releaseDates = new Map(minors.map((m) => [m, day(rn.time[`${m}.0`])]));
  const latestMinor = minorOf(rn['dist-tags'].latest ?? minors.at(-1)!);
  const ascending = [...minors];

  const built = await pool(minors, 4, async (minor): Promise<ReleaseMinor> => {
    const version = latestByMinor.get(minor)!;
    const meta = rn.versions[version]!;
    const deps = { ...meta.devDependencies, ...meta.dependencies };
    const old = prevByMinor.get(minor);
    const pkgUrl = `${CDN}/react-native@${version}/package.json`;

    // Toolchain: reuse when the latest patch is unchanged, otherwise re-read the shipped files.
    let toolchain: Toolchain = { ...(old?.toolchain ?? {}) };
    let toolchainFrom = old?.toolchainFrom ?? null;
    if (FULL || toolchainFrom !== version) {
      const tplVersion = minorNum(minor) >= 75 ? templateLatest.get(minor) ?? null : null;
      if (minorNum(minor) >= 75 && !tplVersion) {
        warn(`no @react-native-community/template release for ${minor}; Android/Gradle may be incomplete`);
      }
      const fresh = await readToolchainFiles(version, tplVersion);
      if (fresh) {
        toolchain = { ...toolchain, ...fresh };
        toolchainFrom = version;
      }
    }
    if (meta.engines?.node) toolchain.node = { value: meta.engines.node, source: pkgUrl };
    const ext = externalDeps?.get(minor);
    if (ext?.jdk) toolchain.jdk = { value: ext.jdk, source: SUPPORT_DOC };
    if (ext?.node) toolchain.nodeDocumented = { value: ext.node, source: SUPPORT_DOC };
    // Xcode: the build script's check and the release crew's table sometimes disagree; take the stricter.
    if (ext?.xcode && (!toolchain.xcode || compareDotted(ext.xcode, toolchain.xcode.value) > 0)) {
      toolchain.xcode = { value: ext.xcode, source: SUPPORT_DOC };
    }

    // Support status: the release crew's table wins; minors older than the table are unsupported.
    const row = policy?.get(minor);
    let status: SupportStatus;
    let statusSource = RELEASES_PAGE;
    if (row) {
      // A published stable minor still listed as "Future" means the table hasn't caught up yet.
      status = row.status === 'future' ? 'active' : row.status;
    } else if (policy) {
      const oldest = [...policy.keys()].sort(compareMinor)[0]!;
      status = compareMinor(minor, oldest) < 0 ? 'unsupported' : old?.support.status ?? 'active';
    } else if (old) {
      status = old.support.status;
      statusSource = old.support.source;
    } else {
      // No table and no history: fall back to the documented rule (latest 2 active, 3rd end of cycle).
      const rank = ascending.length - 1 - ascending.indexOf(minor);
      status = rank <= 1 ? 'active' : rank === 2 ? 'end-of-cycle' : 'unsupported';
      statusSource = 'https://reactnative.dev/releases/versioning-policy';
    }

    const reactRange = meta.peerDependencies?.react ?? meta.dependencies?.react;
    return {
      minor,
      latest: version,
      firstReleased: releaseDates.get(minor)!,
      latestReleased: day(rn.time[version]),
      react: reactRange ? ({ value: reactRange, source: pkgUrl } satisfies Sourced<string>) : old?.react ?? null,
      hermes: hermesFor(minor, version, deps),
      support: {
        status,
        source: statusSource,
        history: nextHistory(
          old?.support.history,
          status,
          () => backfillHistory(minor, status, releaseDates, ascending),
          today,
        ),
      },
      blog: row?.blog ?? old?.blog ?? null,
      releaseNotes: `https://github.com/react/react-native/releases/tag/v${minor}.0`,
      toolchain: sortKeys(toolchain),
      toolchainFrom,
    };
  });

  // Upcoming minor: the lowest "Future" row in the table that has no stable release yet.
  const futureMinor = policy
    ? [...policy.entries()]
        .filter(([m, r]) => r.status === 'future' && !latestByMinor.has(m))
        .sort(([a], [b]) => compareMinor(a, b))[0]
    : undefined;
  const nextTag = rn['dist-tags'].next;
  const upcoming = futureMinor
    ? {
        minor: futureMinor[0],
        version: nextTag && minorOf(nextTag) === futureMinor[0] ? nextTag : null,
        expected: futureMinor[1].releaseDate,
        source: RELEASES_PAGE,
      }
    : prev?.upcoming && !latestByMinor.has(prev.upcoming.minor)
      ? prev.upcoming
      : null;

  // Keep minors we knew about but failed to rebuild (shouldn't happen, but never lose rows).
  const builtMinors = new Set(built.map((b) => b.minor));
  const kept = (prev?.minors ?? []).filter((m) => !builtMinors.has(m.minor));
  const all = [...built, ...kept].sort((a, b) => compareMinor(b.minor, a.minor));

  const next: Omit<ReleasesFile, 'generatedAt'> = {
    schema: 1,
    latest: latestMinor,
    upcoming,
    minors: all,
    expo,
  };

  const unchanged =
    prev && JSON.stringify({ ...prev, generatedAt: undefined }) === JSON.stringify({ ...next, generatedAt: undefined });
  if (unchanged) {
    console.log(`releases.json unchanged (${all.length} minors, ${expo.length} Expo SDKs)`);
  } else {
    const { schema, ...rest } = next;
    const file: ReleasesFile = { schema, generatedAt: new Date().toISOString(), ...rest };
    await writeFile(OUT, `${JSON.stringify(file, null, 2)}\n`);
    console.log(`releases.json written (${all.length} minors, ${expo.length} Expo SDKs)`);
  }
  if (warnings.length) console.log(`${warnings.length} warning(s); last-good data kept where needed`);
}

function sortKeys<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))) as T;
}

main().catch((err) => {
  // Network/source failures are handled above and never reach here; this is a bug in the script.
  console.error('fetch failed unexpectedly:', err);
  process.exitCode = 1;
});
