# react-native.dev

**[react-native.dev](https://react-native.dev)** is a React Native version compatibility matrix. Pick the React Native version you're on and it tells you which Expo SDK, React, Hermes, Xcode, iOS deployment target, Android SDK levels, Node, JDK and Gradle go with it, and whether that version is still supported.

It's a single static page that updates itself twice a day. No accounts, no ads, no cookies, no newsletter.

> Independent project, not affiliated with the React Foundation.
> For the React Native docs, go to [reactnative.dev](https://reactnative.dev).

Sibling site: [reactjs.dev](https://reactjs.dev) tracks React releases.

## What's on the page

- **Lookup**: type `0.81` (or `81`, or `v0.81.4`) and get a one-line answer, with the row highlighted. Deep links work too: `https://react-native.dev/#v0.81`.
- **The matrix**: one row per React Native minor since 0.60, newest first. Every value links to the source it came from. Values that couldn't be confirmed carry a visible `?` marker.
- **Store deadlines**: Apple's minimum Xcode/SDK for App Store uploads and Google Play's target API level, with countdowns.
- **[`/matrix.json`](https://react-native.dev/matrix.json)**: the merged data as public JSON (CORS enabled).
- **[`/feed.xml`](https://react-native.dev/feed.xml)**: RSS of new minors and support-status changes (last 50).

## Where each column comes from

All automatic sources are read by `scripts/fetch.ts` and written to `data/releases.json`. Toolchain values are read from files inside the **published npm tarballs** of the exact patch version, via jsDelivr. Each value's source link is that exact file.

| Column | Source |
|---|---|
| React Native version, release dates | npm registry: `react-native` (latest stable patch per minor; `.0` publish date) |
| Support status | The release crew's table on [reactnative.dev/releases](https://reactnative.dev/releases) ([`_releases-table.md`](https://github.com/react/react-native-website/blob/main/website/src/components/releases/_releases-table.md)). Minors older than the table are EOL. |
| React | `peerDependencies.react` in the published `react-native/package.json` |
| Expo SDK | `react-native` in `expo@<sdk>/bundledNativeModules.json`. Older SDKs without that file fall back to Expo's versions API (`api.expo.dev/v2/versions`). |
| Hermes | `hermes-engine` / `hermes-compiler` in `react-native/package.json`. "Default" from 0.70 and "V1 default" from 0.84, per the release posts. |
| Xcode min | `min_xcode_version_supported` in `scripts/cocoapods/helpers.rb`, or the release crew's [support table](https://github.com/reactwg/react-native-releases/blob/main/docs/support.md#external-dependencies-supported), whichever is stricter. Older versions come from `curated.yaml`. |
| iOS min | `min_ios_version_supported` in `helpers.rb` / `react_native_pods.rb`, or `platform :ios` in the template Podfile |
| Android min / compile / target | The template's `android/build.gradle`, falling back to `gradle/libs.versions.toml` |
| Node | `engines.node` in `react-native/package.json` (what package managers enforce). A ◆ marks rows where the release crew's table lists a different minimum. |
| JDK | Release crew's support table (0.71+). Older versions come from `curated.yaml`, sourced from the archived setup docs. |
| Gradle | `gradle-wrapper.properties` in the app template (`react-native/template` or `@react-native-community/template`) |
| Upgrade | Upgrade Helper diff from the previous minor's latest patch |
| Release notes | Release blog post from the releases table, otherwise the GitHub release |
| Breaking change | `curated.yaml`, one line per minor, quoted from the release post |

### Support policy

The site doesn't compute support itself; it reads the release crew's published table. If that table can't be fetched, the last-good status is kept. If there's no previous data at all, the fallback rule is the [documented policy](https://github.com/reactwg/react-native-releases/blob/main/docs/support.md): the latest two minors are *Active*, the third is *End of Cycle*, older ones are *Unsupported*. Status-change dates the cron didn't see happen are back-filled from that rule and flagged as estimated in the RSS feed.

Badges: **CURRENT** (latest stable, active), **SUPPORTED** (active), **END OF CYCLE** (still patched, winding down), **EOL** (unsupported).

## Correcting a value

1. Edit [`data/curated.yaml`](data/curated.yaml). Every value is `{ value, source }`. The source must be a URL anyone can open.
2. Set it on the entry for the exact minor you're correcting. A value set on a minor's own entry overrides the generated data.
3. Use `verified: false` if the source doesn't state the value outright. The site shows it with a `?` marker.
4. Open a PR. CI runs the tests, which fail if any curated value lacks a source.

Entries are sparse. Toolchain fields inherit from the nearest older entry, but an inherited value only fills gaps the generated data leaves empty. `note` (the breaking-change line) is never inherited.

Never hand-edit `data/releases.json`; the cron overwrites it.

## Running locally

Requires Node 22.18+ (scripts run as TypeScript natively; `.nvmrc` pins 24).

```sh
npm ci
npm run fetch   # refresh data/releases.json from the network (optional; the committed file works)
npm test        # data checks
npm run build   # static site in dist/
npm run preview # serve dist/ at http://localhost:4321
```

`npm run fetch -- --full` re-reads every version's toolchain files instead of only new patches. `npm run brand` regenerates the favicon, sprites and OG image from the pixel maps in `scripts/brand.ts`.

## How the refresh works

[`.github/workflows/refresh.yml`](.github/workflows/refresh.yml) runs every 12 hours (and on manual dispatch). It runs the fetch, the tests and the build, and commits `data/releases.json` only if it changed, with the message `data: refresh react native versions`. The push triggers a Netlify deploy. Netlify only builds from committed files; the fetch never runs during a Netlify build.

The fetch never fails the run because a source is down. Any failed source or version keeps its last-good values and logs a warning. Only a bug in the script exits non-zero.

## Environment variables

| Name | Where | Purpose |
|---|---|---|
| `PUBLIC_CF_BEACON_TOKEN` | `netlify.toml`, production context only | Cloudflare Web Analytics (cookieless). If unset, which is the default for local and preview builds, no analytics snippet is emitted. |

The refresh workflow uses the built-in `GITHUB_TOKEN`; there are no other secrets.

## Stack

Astro (static output) + TypeScript, `yaml` for the curated file. Vanilla JS for the lookup and filters. Fonts are self-hosted: [Silkscreen](https://fonts.google.com/specimen/Silkscreen) and [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono), both SIL OFL 1.1 (licences in `public/fonts/`). The pixel mark is original artwork.

## Contributing

Corrections with a source are the most valuable contribution: PR [`data/curated.yaml`](data/curated.yaml). Bugs and ideas go in [issues](https://github.com/react-help/react-native-dev/issues).

## Licence

[MIT](LICENSE)
