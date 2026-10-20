# AGENTS.md

Local Expense Tracker & Budgeter — an offline-only Android expense tracker.
React + Vite + Tailwind + shadcn/ui UI running inside a Capacitor WebView, over a
Kotlin native core (Room, DataStore, NotificationListenerService, SMS import).

Spec: `Local Expense Tracker & Budgeter Product and Technical Plan.md`.

## Environment

- **JDK 21** is required (AGP 8.x + `jvmTarget = 21`). The system `java` is JDK 11.
  Gradle is pinned to the JDK 21 install via `org.gradle.java.home` in
  `android/gradle.properties`, so plain `./gradlew` works. If the JDK moves,
  update that path (current: `/home/darzh/.local/jdk/jdk-21.0.12.1+1`).
- **Android SDK** at `/home/darzh/Android/Sdk` (also in `android/local.properties`).
- **No emulator or device on this machine** (no `/dev/kvm`, `adb devices` empty).
  Verify with builds and JVM/Robolectric tests; instrumented/espresso tests cannot run.
- Node 22.
- **The project drive is an external disk that corrupts build artefacts**
  (truncated jars, unreadable Gradle execution history). `~/.gradle/init.d/finxeity-build-dir.gradle`
  moves the build output and the project cache to `/tmp/finxeity-build` for this
  project only. Delete that file once the drive is healthy. The APK then lands in
  `/tmp/finxeity-build/app/outputs/apk/sideload/debug/`, not under `android/app/build`.

## Build & test

```bash
# Web (run from repo root)
npm run typecheck      # tsc -b
npm run test           # vitest (jsdom)
npm run lint           # oxlint
npm run build          # tsc -b && vite build -> dist/

# Native (run from repo root)
npm run cap:sync       # copy dist/ into the Android project — do this after `npm run build`
npm run android:test   # :app:testSideloadDebugUnitTest (Robolectric + Room)
npm run android:build  # build web + sync + :app:assembleSideloadDebug
```

Native equivalents live in `android/` (`./gradlew :app:assembleSideloadDebug`, etc.).

## Flavors

Two product flavors on the `distribution` dimension:

- `sideload` — full feature set, declares `READ_SMS`; `BuildConfig.SMS_IMPORT_ENABLED = true`.
- `play` — omits `READ_SMS`; `BuildConfig.SMS_IMPORT_ENABLED = false`.

**Invariant: release manifests must NOT contain `android.permission.INTERNET`.**
Only `android/app/src/debug/AndroidManifest.xml` adds it. Re-check the merged
manifest after touching anything permission-related:

```bash
cd android && ./gradlew :app:processSideloadReleaseManifest :app:processPlayReleaseManifest
# then inspect build/intermediates/merged_manifests/{sideloadRelease,playRelease}/.../AndroidManifest.xml
```

## Release signing

Credentials are in `android/keystore.properties` (gitignored) pointing at
`android/keystore/release.jks` (gitignored). `android/app/build.gradle` loads them
if present and attaches `signingConfigs.release`; without the file the release
build still works but is unsigned.

```bash
cd android && ./gradlew :app:assembleSideloadRelease :app:assemblePlayRelease
```

**Back up `android/keystore/release.jks` and `android/keystore.properties`** — losing
them means you cannot ship updates to an installed app under the same identity.

## Layout

- `src/routes/**` — screens (onboarding, dashboard, transactions, review, recurring, history, settings).
- `src/lib/plugin.ts` — typed Capacitor bridge to the native `LocalExpense` plugin.
- `src/lib/plugin-mock.ts` — in-memory mock used when not on a native platform (dev/browser/tests).
- `android/app/src/main/java/com/localexpense/tracker/`
  - `data/` — Room entities, DAOs, database (`AppDatabase`, v3), repository, ingestion pipeline, dashboard maths, summary cache.
  - `plugin/ExpensePlugin.kt` — Capacitor plugin surface exposed to the WebView.
  - `capture/` — notification listener + pure text extractor.
  - `parse/` — message classifier, amount parser, merchant normalizer, sender templates, parser.
  - `work/` — the background job that rebuilds the summary cache and the recurring payments.
  - `accounts/`, `sms/`, `apps/`, `settings/` — balance derivation, SMS import, app allowlist, preferences.

## Parsing

The parser is pure Kotlin in `parse/` and knows nothing about the database.
Templates per sender are tried first, generic patterns after them; the parser
returns a confidence, and only a parse at or above
`TransactionParser.CONFIDENCE_THRESHOLD` becomes a transaction. Everything
shakier waits in the review queue.

Golden fixtures live in `android/app/src/test/resources/fixtures/parse_fixtures.json`
and are checked by `ParseFixtureTest`. Add a case for every new notification
shape; the corpus is the contract.

`TransactionParser.PARSE_VERSION` goes up when the rules change. "Read all
messages again" in Settings reparses every stored message, so old transactions
are rebuilt with the new rules; corrections the user made are carried over.

## Removal

Removing a read is one transaction in `data/EventLifecycle.kt`: the raw event is
marked dismissed, the transaction it made is voided, the corrections made on it
are retracted and the balance checkpoints it produced are dropped. Restoring
rebuilds all of that from the stored message, so a removal followed by a
restore leaves the same state as before. `EventLifecycleTest` keeps that true.

## Dashboard

`data/DashboardService.kt` and `data/RecurringService.kt` compute every number
the dashboard shows, purely from the active transactions. Keep them pure and
tested: the plugin hands the rows over and gets the figures back, so the same
code can drive the what-if simulator later without touching the database.

The heavy aggregates are cached in `daily_summaries` and rebuilt by
`work/MaintenanceWorker.kt`. The cache is only used when it is newer than the
last transaction change, so a stale cache can never show a wrong number; the
two paths are kept in step by `SummaryServiceTest`.

`Feature Queue.md` holds the ten features that are scoped but not built, with
what each one needs. Read it before starting anything new, and add to it rather
than scattering plans around.

## Conventions

- Money is stored and passed as integer **paise**; format via `src/lib/money.ts`.
- Do not add code comments unless they explain non-obvious intent.
- Keep `npm run typecheck`, `npm run lint`, `npm run test`, and
  `npm run android:test` green before finishing a change.
