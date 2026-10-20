# Local Expense Tracker & Budgeter: Product and Technical Plan

Plan v1 · Android · fully on-device · Capacitor + React + shadcn/ui

## 1. Overview

An Android app that passively tracks spending by reading payment notifications, classifies each transaction on-device, and presents a rich dashboard (balances, burn rate, recurring payments, savings potential). Budgeting is a separate, optional layer on top. Nothing leaves the phone.

**Goals**

- Zero-effort tracking: after onboarding, transactions appear without manual entry.
- Every automated decision is visible and reversible, including a notification history where false positives can be removed along with their effects.
- Fully local: no network, no account, no cloud models.
- A dashboard that answers: where is my money going, how fast, and what can I save?

**Non-goals (v1)**

- Bank-API / Account Aggregator integrations, multi-device sync, iOS, shared or family accounts.
- Investment tracking.

## 2. Design principles

1. **Raw events are immutable; everything else is derived.** This is what makes removal of a false positive clean and safe.
2. **Capture never depends on the UI.** The listener, parser, classifier and database live in native Kotlin; the WebView only renders.
3. **Local is enforced, not promised.** The release build ships without the INTERNET permission.
4. **Passive by default, opt-in for nagging.** Budgets and alerts are off until the user enables them.
5. **Show your work.** Low-confidence parses go to a review queue instead of silently polluting the numbers.

## 3. User flows

### 3.1 Onboarding

1. **Welcome and privacy promise.** One screen: what is read (only the apps you pick), what is stored, and that nothing leaves the device.
2. **Enable notification access.** Explain why, then deep-link to the system Notification access settings. On Android 13+ sideloaded builds, show a pre-step guiding the user through App info → ⋮ → Allow restricted settings, otherwise the toggle is greyed out. Detect the grant when the app resumes and auto-advance. If the user returns without granting, stay on the step with a retry button and a short troubleshooting hint.
3. **Choose apps to monitor.** A searchable list of launchable installed apps, in three sections: the detected default messaging app (preselected), suggested finance apps matched against a bundled list of known bank, UPI, card and wallet packages, and all other apps. Continue is enabled once at least one app is selected. The selection stays editable in Settings.
4. **Sync account balances.** The app proposes accounts it can identify (see section 8), the user confirms or edits the current balance for each, or adds accounts manually. Skipping is allowed; balance and runway widgets then show a prompt to complete setup instead of wrong numbers.
5. **Keep tracking reliable (optional).** Request the battery-optimization exemption and explain why OEM battery managers can stop the listener.
6. **Done.** Show listener status (live), then land on the dashboard. The empty state explains that data appears as notifications arrive.

### 3.2 Everyday use

Mostly passive. New transactions appear in the list and dashboard. Anything below the confidence threshold lands in a **Needs review** inbox where the user can confirm, edit, or dismiss it with one tap.

### 3.3 Notification history and false-positive removal

A dedicated screen lists every notification the app has read from monitored apps, newest first, with filter tabs: **All · Became a transaction · Ignored (not a spend) · Removed**. Each row shows the app, timestamp, a text preview, and the outcome (for example “₹450 · Swiggy · Food”). Tapping a row expands the full raw text and parsed fields.

Actions on a row:

- **Remove this one.** Marks the read as dismissed and undoes everything it caused (balance, totals, budget usage, recurring detection, classifier learning). An undo toast stays visible for several seconds, and the item remains restorable from the Removed tab.
- **Ignore messages like this.** Creates an ignore rule (sender app plus a message template) so similar notifications stop being turned into transactions in future.
- **Mark as spend / income.** The reverse case: a notification the parser skipped can be promoted into a transaction manually.
- **Delete permanently.** Hard-deletes the raw text. Available from the Removed tab and on a retention schedule.

### 3.4 Budgeting (optional)

Enabled from a dashboard card or Settings. A short setup flow: choose categories to budget, accept suggested limits (based on the user’s trailing three-month median per category) or edit them, set the period start day, choose rollover on or off, and pick alert thresholds (for example 50 / 80 / 100%). Alerts are local notifications with quiet hours. Disabling budgeting hides its UI and stops alerts without touching transaction data.

## 4. Screens and shadcn/ui mapping

| Screen | Purpose | Main shadcn/ui components |
| --- | --- | --- |
| Onboarding steps | Permission, app picker, balances | Card, Button, Progress, Alert, Checkbox/Switch, Input, Badge, ScrollArea, Command (app search) |
| Dashboard | Balances, burn rate, cashflow, categories, recurring, savings potential | Card, Chart (Recharts), Tabs, Badge, Progress, Skeleton, Select |
| Transactions | Filterable list, edit, recategorize | Drawer (bottom sheet), Input, Badge, Command (category picker), Popover + Calendar (range), Sonner |
| Notification history | Audit trail and removal | Tabs, Card, Collapsible (raw text), DropdownMenu, AlertDialog, Sonner (undo), Badge |
| Needs review | Low-confidence queue | Card, Button, Drawer |
| Recurring | Detected subscriptions and bills | Card, Switch (confirm/ignore), Badge, Table |
| Budgets | Limits and progress | Progress, Slider, Switch, Dialog, Input |
| Settings | Monitored apps, accounts, rules, reliability, export | Switch, Select, Accordion, Separator, Alert |

## 5. Architecture

```
React + Vite + Tailwind + shadcn/ui  (Capacitor WebView)
        ▲ plugin calls / events
Custom Capacitor plugin (typed API)
        ▲
Native Kotlin core: owns all state
  NotificationListenerService → allowlist → dedupe → raw_events
  → Parser (templates → ML fallback) → Classifier → Room/SQLite
  WorkManager: recurring detection, budget alerts, reparse jobs
  On-device models: ONNX Runtime Mobile / TFLite (bundled in assets)
```

The native layer owns the database; the UI never opens it directly. Plugin API (sketch):

- Setup: `getListenerStatus`, `openNotificationSettings`, `getCandidateApps`, `setMonitoredApps`, `listAccounts`, `setAccountBalance`.
- Reads: `listTransactions(filter, cursor)`, `getDashboard(range)`, `listRawEvents(filter, cursor)`, `getRecurring()`.
- Writes: `correctTransaction(id, patch)`, `dismissEvent(id)`, `restoreEvent(id)`, `createIgnoreRule(eventId)`, `promoteEvent(id, as)`, budget CRUD, `exportData()`.
- Events pushed to the UI: `transactionAdded`, `dataChanged(scope)`, `listenerHealthChanged`.

## 6. Data model (event-sourced)

- **raw\_events**: id, package, notification key, title, text/big text, posted\_at, content hash, `status` (parsed / ignored / needs\_review / dismissed), `dismissed_at`, `parse_version`. Immutable except for status.
- **transactions**: id, raw\_event\_id, account\_id, amount (integer minor units), direction (debit / credit), merchant\_id, category\_id, occurred\_at, confidence, `status` (active / voided), source (auto / manual).
- **accounts**: id, display name, last digits, type, `anchor_balance`, `anchor_at`.
- **balance\_checkpoints**: account\_id, balance, observed\_at, raw\_event\_id (balances parsed from notifications).
- **merchants**: normalized name, aliases, default category.
- **categories**, **rules** (categorization and ignore rules), **corrections** (user-labeled examples that feed the classifier, each linked to its transaction).
- **recurring**: merchant, typical amount, cadence, next expected date, status (suggested / confirmed / ignored).
- **budgets**: category, period, limit, rollover, alert thresholds.

All dashboard numbers are computed from `transactions WHERE status = active`. That single rule is what guarantees removals propagate everywhere.

## 7. Ingestion pipeline

1. **Capture.** The listener only processes notifications from allowlisted packages. Read title, text, big text, text lines and messaging-style messages, because banks use different fields.
2. **Persist raw first** with a content hash, before any parsing.
3. **Dedupe.** Notifications are re-posted and updated; the same spend also arrives via SMS and the payment app. Dedupe on notification key plus content hash, then on amount, time window and reference ID or merchant across sources.
4. **Classify the message type.** Spend, credit, balance-only, OTP, promo, other. Non-spend types stay in history as Ignored.
5. **Parse.** Per-sender templates first (amount, direction, merchant, account digits, balance); a small ML extractor handles formats no template matches.
6. **Categorize.** Rules and merchant dictionary, then embedding + kNN over the user’s corrections, with an optional on-device LLM for ambiguous merchants (never on the ingestion path).
7. **Confidence gate.** Above threshold: auto-create. Below: Needs review.

A platform limitation to design around: a notification listener only sees notifications posted while access is enabled. It cannot read past notifications, so history starts at onboarding.

## 8. Account and balance model

Because of that limitation, the “sync account balance” step needs a concrete mechanism:

1. **Detect accounts** from notifications currently in the shade at grant time (sender app plus last digits), and from balance-bearing notifications that arrive later.
2. **Anchor balance.** The user confirms or types the current balance per account. This becomes `anchor_balance` at `anchor_at`.
3. **Derived balance** = anchor + signed sum of active transactions after `anchor_at`.
4. **Self-correcting.** When a notification includes an available balance, store a checkpoint; if it differs from the derived balance, show a small “balance drifted, reconcile?” prompt rather than silently overwriting.
5. **Optional backfill:** a one-time SMS import (READ\_SMS) could recover recent history. It is a restricted permission on Google Play, so treat it as sideload-only and optional.

## 9. Dashboard: metrics and definitions

| Widget | Definition |
| --- | --- |
| Total balance / per account | Derived balance (section 8) |
| Burn rate | Average daily spend over the trailing 30 days, excluding transfers between own accounts and flagged one-off large items; also shown as monthly |
| Runway | Total balance ÷ burn rate |
| Cashflow | Income vs spend by week or month, with net |
| Category breakdown | Share and month-over-month change per category |
| Top merchants | Ranked by spend and by frequency |
| Recurring payments | Merchant + similar amount + regular cadence; shows monthly total, next due dates, and price increases |
| Savings potential | Sum of (a) discretionary categories above the user’s own trailing median, (b) recurring payments that increased or look duplicated, (c) fees and charges. Each item is shown with its source so the number is explainable |
| Safe to spend today | Remaining budget or (balance − upcoming recurring) spread over days left, shown only when relevant data exists |
| Needs review | Count of low-confidence items |

Heavy aggregates are computed by WorkManager jobs and cached in summary tables, invalidated by `dataChanged` events so the UI stays fast.

## 10. Budgeting module

- Category budgets with a configurable period start day and optional rollover.
- Progress states: on track, approaching, over, shown on the dashboard and Budgets screen.
- Threshold alerts via local notifications, deduplicated per period, respecting quiet hours.
- Suggestions from history, never auto-applied.
- Fully optional: removing it leaves all tracking intact.

## 11. False-positive removal: how effects are undone

When the user removes a read, one SQLite transaction performs:

1. `raw_events.status = dismissed`.
2. The linked `transactions.status = voided`.
3. Linked `corrections` are retracted so the classifier does not learn from a false positive (and optionally recorded as a negative example for the message-type classifier).
4. Affected balance checkpoints are re-evaluated.
5. Summary tables for the affected time window are marked stale and rebuilt; recurring detection and budget usage are recomputed for the affected merchant and period.
6. A `dataChanged` event tells the UI to refetch.

Restore reverses the same steps. Because every number derives from active transactions, no widget can keep showing a removed item. Dismissal is a soft delete until the user deletes permanently or the retention window passes.

## 12. Frontend plan: shadcn/ui on Capacitor

- **Stack:** React + TypeScript + Vite, Tailwind, shadcn/ui, TanStack Query (reads through the plugin, invalidated by native events), react-hook-form + zod, React Router. Use Capacitor core only; do not mix Ionic UI components with shadcn.
- **Mobile adaptation:** bottom tab bar; safe-area insets via `env(safe-area-inset-*)`; use Drawer instead of centered Dialog for sheets; minimum 44px touch targets; no hover-only affordances; hardware back handled with `@capacitor/app`; system dark mode.
- **Lists:** virtualize long lists (transactions, notification history) with TanStack Virtual and cursor pagination from the plugin.
- **Charts:** shadcn Chart (Recharts) fed by pre-aggregated series; keep points per chart modest.
- **Money:** integer minor units end to end; format with `Intl.NumberFormat`; currency and locale configurable.
- **Performance:** route-level code splitting, minimal animation, skeletons while the plugin loads.
- **Setup:** `npx shadcn@latest init` in the Vite project, then add components as needed (card, drawer, tabs, chart, sonner, command, and so on).

## 13. Privacy and security

- No INTERNET permission in release builds; models and assets bundled in the APK.
- Monitored-app allowlist enforced in native code; non-selected apps are never read.
- Optional database encryption (SQLCipher) with a key in Android Keystore; optional app lock (biometric).
- Auto-backup disabled for the database; encrypted export/import through the system file picker.
- Raw text retention setting (for example keep 90 days, then keep parsed fields only), traded off against reparse ability.
- A visible “data stays on this device” indicator and a one-tap wipe-all.

## 14. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| OEM battery managers kill the listener | Battery exemption prompt, listener health indicator, self-check job, guidance per OEM |
| Notification formats change or vary | Template library with versioning, fixtures, ML fallback, review queue, reparse on upgrade |
| Duplicate transactions across sources | Layered dedupe with reference IDs; dismissal tools in history |
| Restricted-settings friction on sideloaded installs | Explicit onboarding pre-step with screenshots |
| No access to past notifications | Anchor balance model; optional SMS backfill |
| Play Store policy limits for notification/SMS access | Plan for sideload / F-Droid distribution first |
| On-device LLM cost (battery, RAM) | Optional, on-demand only, never in the capture path |

## 15. Testing strategy

- A fixture corpus of real (redacted) notifications per sender, with golden parse outputs; run on every parser change.
- Unit tests for dedupe, balance derivation, recurring detection and the removal cascade (including remove then restore equals original state).
- Instrumented tests for the listener service using synthetic posted notifications.
- Manual device matrix across at least two OEM skins for background reliability.
- Classifier evaluation on held-out labeled data; track accuracy and the share routed to review.

## 16. Milestones

| # | Milestone | Acceptance criteria |
| --- | --- | --- |
| 1 | Capture spike | Listener logs allowlisted notifications to Room and survives a day of normal use; bare list UI |
| 2 | Onboarding | Full flow works end to end including permission detection, app picker with default SMS app preselected, account balance step |
| 3 | Parser v1 + dedupe | Templates for the author’s own senders pass fixtures; duplicates collapse correctly |
| 4 | Transactions + history | Transaction list, edit, Needs review, notification history with remove, restore and ignore-similar; cascade tests green |
| 5 | Dashboard | Balances, burn rate, runway, cashflow, categories, recurring, savings potential |
| 6 | Budgeting | Setup flow, progress, threshold alerts, optional toggle |
| 7 | Classifier | Rules + embedding kNN with corrections loop; ML extractor fallback |
| 8 | Hardening | Encryption, app lock, export/import, battery reliability, polish |
| 9 | Optional LLM | Natural-language queries and monthly summaries, opt-in |

## 17. Open questions (ask user with options for each)

1. Should the balance step rely on manual entry plus notification checkpoints only, or also offer the sideload-only SMS import for backfill?
2. Which currencies and locales must v1 support?
3. Is Play Store distribution a goal, or is sideload / F-Droid acceptable for v1?
4. Should credits (income, refunds) be tracked with equal depth, or spend-only at first?
5. Retention default for raw notification text: keep indefinitely, or purge after a fixed window?
