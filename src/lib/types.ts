// Shared shapes for data/releases.json (generated) and data/curated.yaml (hand-maintained).
// Imported by scripts/, tests/ and the Astro pages, so keep it free of runtime code.

/** A value plus the URL anyone can open to verify it. */
export interface Sourced<T> {
  value: T;
  source: string;
  /** false = could not be confirmed against the source; rendered with a visible marker. */
  verified?: boolean;
}

export type SupportStatus = 'future' | 'active' | 'end-of-cycle' | 'unsupported';

export interface StatusChange {
  status: SupportStatus;
  /** YYYY-MM-DD */
  since: string;
  /** true when the date was back-filled from the support rule rather than observed by the cron. */
  estimated?: boolean;
}

export interface Toolchain {
  ios?: Sourced<string>;
  xcode?: Sourced<string>;
  minSdk?: Sourced<number>;
  compileSdk?: Sourced<number>;
  targetSdk?: Sourced<number>;
  /** `engines.node` from the published package.json — what package managers enforce. */
  node?: Sourced<string>;
  /** "Node min." from the release crew's support table, when it is published. */
  nodeDocumented?: Sourced<string>;
  jdk?: Sourced<string>;
  gradle?: Sourced<string>;
}

export interface Hermes {
  /** Hermes is the default engine (0.70+). */
  default: boolean;
  /** Short label for the cell, e.g. "Default", "V1 default", "Opt-in". */
  label: string;
  /** `hermes-engine` range for versions before Hermes was bundled. */
  engine: string | null;
  /** `hermes-compiler` version for 0.82+. */
  compiler: string | null;
  source: string;
}

export interface ReleaseMinor {
  /** "0.87" */
  minor: string;
  /** Latest stable patch, "0.87.1" */
  latest: string;
  firstReleased: string;
  latestReleased: string;
  react: Sourced<string> | null;
  hermes: Hermes;
  support: {
    status: SupportStatus;
    source: string;
    history: StatusChange[];
  };
  blog: string | null;
  releaseNotes: string;
  toolchain: Toolchain;
  /** Patch version the toolchain files were read from; lets the fetch skip unchanged versions. */
  toolchainFrom: string | null;
}

export interface ExpoSdk {
  sdk: number;
  /** Latest published patch of this SDK's `expo` package. */
  latest: string;
  released: string;
  reactNative: string;
  /** RN minor the SDK targets, "0.81" */
  minor: string;
  prerelease: boolean;
  source: string;
  releaseNotes: string | null;
}

export interface ReleasesFile {
  schema: 1;
  /** Last time the content changed (not the last time the cron ran). */
  generatedAt: string;
  latest: string;
  upcoming: { minor: string; version: string | null; expected: string | null; source: string } | null;
  minors: ReleaseMinor[];
  expo: ExpoSdk[];
}

// ---- curated.yaml ----------------------------------------------------------

export type CuratedField = 'xcode' | 'ios' | 'minSdk' | 'compileSdk' | 'targetSdk' | 'node' | 'jdk' | 'gradle';

export interface CuratedEntry {
  minor: string;
  xcode?: Sourced<string>;
  ios?: Sourced<string>;
  minSdk?: Sourced<number>;
  compileSdk?: Sourced<number>;
  targetSdk?: Sourced<number>;
  node?: Sourced<string>;
  jdk?: Sourced<string>;
  gradle?: Sourced<string>;
  /** One-line breaking-change note. Never inherited. */
  note?: Sourced<string>;
  /** Override for the derived upgrade-helper link. Never inherited. */
  upgrade_helper?: string;
}

export interface StoreDeadline {
  id: string;
  store: 'App Store' | 'Google Play';
  title: string;
  detail: string;
  date: string;
  source: string;
  verified?: boolean;
}

export interface CuratedFile {
  versions: CuratedEntry[];
  store_deadlines: StoreDeadline[];
}
