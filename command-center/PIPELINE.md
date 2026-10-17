# Sentinel publishing pipeline v2

Google Sheets remains authoritative. Published JSON remains compatible with Checklist Vault and ChatBot. No SQL service or new hosting account is required.

## Import integrity

Product replacement batches contiguous ranges and clears only surplus rows for that product. Empty parallel lists clear obsolete parallels. A script lock serializes source imports. Before mutation, a private recovery spreadsheet records the previous product rows from each affected tab. Recovery records append a version and a completion marker; interrupted saves preserve the previous complete record. Imports must pass exact row counts before becoming publishable. Exceptions restore the previous rows; a timed-out import is marked incomplete and the next attempt restores its saved snapshot before proceeding. The exporter refuses a product marked `writing`.

Recovery documents use the existing Spreadsheet authorization. They contain source product data, not admin keys. Do not edit their cells manually. `recovery_snapshot_id` identifies the document; open it with `https://docs.google.com/spreadsheets/d/<id>/edit` when needed for diagnosis. Test fixtures are separate from production sources.

## Publish lifecycle

1. Sentinel saves a stable request ID in the holding queue before submission.
2. Operator forwards the job to Exporter, which stores its receipt privately in Drive.
3. A minute trigger, `runSentinelPublishJobs`, processes one queued product at a time. The first submission installs this trigger if absent.
4. The exporter pins its reads to one Git commit and stages all changed files.
5. One Git tree/commit and a non-forced branch update publishes the complete release. A staging failure exposes no partial file updates; a concurrent branch change is rejected.
6. Verification compares expected product content hash, release ID, exact row/parallel counts, index data and search content.
7. GitHub confirmation and public Pages confirmation are separate. `published_pages_pending` does not claim that old public data validates the release.
8. The worker or a reconnected browser verifies the existing receipt. It does not repeat uploads to resolve CDN lag. The holding queue retains pending jobs with a `Resume / Verify` button until public verification completes.

Job states: `queued`, `running`, `committing`, `committed`, `verifying`, `published_pages_pending`, `complete`, `failed`. Receipt files preserve commit, expected hashes, attempts, errors and timestamps. Admin keys are not written into receipts. The worker indexes active jobs in Script Properties rather than scanning historical receipt content on every tick. The queue is bounded at 50 active jobs. Interrupted uncertain writes receive verification before any explicit retry; there is no automatic loop of five uploads.

Job polling uses the existing `publishImportedChecklist` action with `job_id`, plus the normal POST admin key. Fresh request URLs and a bounded retry cover read-only status requests. New job submissions and sheet writes are not blindly retried. Closing the browser does not stop an already queued publish. Imports themselves remain synchronous and recoverable.

## PRV and full exports

Ready single-product print-run articles have a Write Print Run Data action. Import re-parses the complete source instead of writing only the preview’s first 200 rows; mixed-product articles remain blocked for review. PRV jobs retain their own queue identity and status.

Product-specific PRV publication updates the product and its affected index/manifest in one commit. A first migration removes that product from a shared legacy shard while preserving its other products. Population files are left to full Vault synchronization. Manual/scheduled Vault syncs and the main legacy checklist export entry points share the release lock and atomic commit helper. Full rebuilds still have Apps Script runtime/request-size limits; use product jobs for normal operation.

## Verification

Run `npm run test:publish`. This includes importer integrity/rollback, snapshot interruption, atomic publication, branch conflict, stale public content, PRV migration, durable job/reconnect, frontend diagnostics and transport tests. `pipeline-regressions.yml` runs these automatically on relevant pushes and pull requests. The existing browser test now exercises the current simple Agent Cycle and blocked PRV display, using read-only fixtures.

Owner-only Apps Script editor checks:

- `runSentinelImportRecoverySmokeTest`: creates isolated fixture/recovery spreadsheets, tests smaller replacement, zero parallels, unrelated rows and rollback. It does not modify production source sheets.
- `runSentinelPipelineSmokeTest` (Exporter): queues and processes the existing Donruss WNBA product, then logs verification.
- `runSentinelOperatorPipelineSmokeTest` (Operator): queues the existing Team Canada Juniors hockey product through the deployed Operator→Exporter handoff. The normal background worker completes it.

- `runSentinelPrvPipelineSmokeTest` (Operator): queues the existing Bowman Chrome Sapphire baseball print-run product through the same persistent publishing path.

These publish smoke tests deliberately create a new release from existing source data. They are manual verification tools, not recurring triggers.

## Deployment

Deploy the tested Exporter and Operator code versions to their existing web-app deployments before publishing the new Sentinel frontend. Keep existing Script Properties and access settings. The frontend build is `simple-agent-pipeline-v2-2026-10-15`; its service-worker cache is v12. Deployments made during this repair preserve unrelated live Apps Script changes. Future changes should compare live and tracked source before replacement.

## Remaining scale limits

Discovery rechecks the newest 20 posts and resumes older archive pages, up to five pages per successful cycle. Its Script Property checkpoint advances only after classification finishes; failed page requests or interrupted classification preserve the previous checkpoint. Reaching the archive end resets the sweep. URL duplicates are removed. At most eight candidate articles receive access checks during discovery; preview checks selected articles. The UI reports whether older pages remain. Source revision comparison and large search download optimization remain separate improvements. Product publication still reads the relevant source tabs, and a very large product can reach Apps Script's execution limit; the receipt/snapshot makes that a visible recoverable state. This repair is not a database migration or a claim of unlimited capacity.

## Source coverage verification (v5)

A populated PRV product starts unverified. Unique normalized product identity (sport, year/season, manufacturer and edition retained) is required before comparison. Discovery reads the structured v2 index and immutable product payload; an unavailable index stops the scan rather than implying empty coverage.

Up to eight sources per cycle are fetched and checked. Exact parsed row names, numeric values, and available checklist sizes are compared against published rows. Missing groups and changed values remain possible updates; ambiguous identities, multiple rows with the same label, serial-limit/estimate mismatches, no parsed rows, and failed reads remain review tasks. Restricted sources remain blocked. Covered means all comparable parsed rows matched, not that unsupported article content was independently validated. No imports are performed by discovery.

Comparisons record a source-row fingerprint and checked timestamp. Results are cached for five minutes, keyed by article URL, product identity, immutable public filename and public revision. A changed public file/revision invalidates the cache immediately; source changes are observed on the next comparison after the five-minute cache expires. Cached verified sources consume no inspection budget, leaving room for other pending sources. A pending comparison is never counted as covered.
