# Sentinel Product Manager

Read-only administrative inventory at `command-center/product-manager/`. The existing Sentinel admin key protects **every data request**. The public static files contain only the sign-in shell and application code. No inventory, source credential, or private cache ID is embedded in them.

## Sources and identity

- CV: `https://app.chasingmajors.com/data/v1/checklists/index.json`, sport manifests under `checklists/products/`, then the product-map shards. Checklist `rows.length` is the JSON card count. `parallels.length` counts parallel definitions separately.
- PRV: `https://app.chasingmajors.com/data/v2/vault/index.json`, then `vault/products/{file}`. Index row counts are compared with actual product payloads; published row issues supply structural quality signals.
- D1: existing `cm-cv-search`, account/database constants in `ProductManager.gs`. Join on **both code and the original sport value**. Count only `cards.type = 'card'`; `product` summary rows and other types are explicitly excluded and retained as separate diagnostic counts. Fixed SQL also finds card groups without a products-table entry.
- Authoring Sheets remain untouched. They are not needed to measure published coverage.

Products match on exact code and normalized sport, or on a unique exact display name/year/sport across sources. Name matching folds case and whitespace only. Ambiguous matches stay separate. Other sports retain their original sport in the identity key, preventing accidental merging of different sports in the Other tab. Original metadata and source identifiers remain available in details. Counts from duplicate source identifiers are never added together.

D1 is the displayed count when its product exists and its observation is recent. Otherwise a verified JSON count is used. Source-specific counts remain distinct. Absence is asserted only from a successfully checked, recent inventory. Unknown counts stay null. A source outage never becomes Missing.

## Validation and freshness

No current source supplies a reliable certificate of full CV or PRV completeness. Positive counts therefore default to **Not Verified**, never Complete. Partial denotes observed structural failures or published PRV row issues. Missing denotes checked absence/zero availability. Sync Issue denotes an observed identity/metadata conflict, indexed missing file, or comparable PRV index/file mismatch.

D1/JSON card-count differences require review; they do not alone prove a sync error because import scope is not certified. CV and PRV counts are never compared as equivalent datasets. Empty PRV products remain in the inventory.

Source observation, publication revision, and file-check times are distinct. D1 has no discovered import timestamp. This module cannot certify synchronization age or source-authoring time. An observation older than 30 hours is marked stale and cannot establish source absence or authoritative D1 selection. This is an inventory freshness policy, not a claim about product release or authoring quality.

## Derived cache and refresh

`productManagerInitialize()` creates one **private, automatically generated cache workbook**, using Sentinel's existing Spreadsheet permission. This is not another editable product catalog. Do not edit or share it. Its ID is held only in Script Properties as `CM_PM_INVENTORY_SHEET_ID`.

The workbook has `PM Cache A`, `PM Cache B`, and `PM Cache Manifest`. Writes replace only the inactive cache tab and commit the manifest pointer last. An interrupted write preserves the previous checkpoint. Each chunk has an inert prefix to prevent formula interpretation. Only two checkpoints are retained, so history does not grow indefinitely. No CV/PRV source sheet is written.

`productManagerRefresh()` is an editor/trigger function, **not a browser endpoint**:

1. Check published indexes at most hourly.
2. Read a healthy D1 product inventory at most daily, using parameterized, fixed SELECT queries. Failed reads retry after an hour; configuring a previously missing credential permits an immediate retry. Failures remain explicit and do not erase the last observed products.
3. Process up to 20 CV shard files and 20 PRV files per invocation, with a 210-second work deadline. Failed files are isolated. New publications preserve unfinished queue order.
4. Recheck files daily or after an index revision change. Last-observed counts retain their original file-check timestamps while a new sweep runs. An older PRV revision is not compared against a new index as proof of a sync failure.
5. Save only derived metadata/counts to the private checkpoint. No card/player rows are retained in the cache.

An owner may install a five-minute time trigger after approval. Initial hydration can take several hours for a large CV shard catalog; progress and unknown counts are visible. Ordinary list/detail requests never start a shard sweep or D1 aggregation. A five-minute private script cache avoids repeatedly reading the checkpoint; the browser requests 40 rows per page and lazy product details, with short-lived in-memory caching only.

The refresh lease uses the shared script lock only briefly to acquire/release a namespaced lease. It releases the lock before source reads, so a long inventory refresh does not hold Sentinel's import lock. A lease expires after eight minutes if execution stops.

Source changes are not read as a cross-system transaction. Metadata mismatches can be temporary during publication; observation times and pending checks should be reviewed before editing data. Unavailable file checks retry on the next sweep. Manifest/source errors remain visible.

## Security

Only POST actions `productManagerList` and `productManagerDetail` are added. Both call existing `requireOperatorKey_` before cache, private workbook, or source access. There is no GET/JSONP inventory route, arbitrary SQL action, arbitrary source URL, browser refresh/write action, or source synchronization action.

`CM_PM_D1_READ_TOKEN` belongs in Apps Script Script Properties only. Use a token limited to D1 Read for the intended Cloudflare account; the adapter fixes the account/database and accepts no caller-supplied query. No token is sent to the browser, included in errors, or committed to Git. Cloudflare's [D1 query API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/) documents the administrative REST query interface.

The UI reuses Sentinel's session-only admin key, removes the old persistent key, renders text with DOM APIs, applies a restrictive CSP, and clears inventory DOM/in-memory caches on Lock. POST responses are not service-worker cached. Product Manager URLs are excluded from the offline shell cache to avoid retaining detail identifiers. Existing shared-key security limitations remain: this is not per-user SSO, and a compromised same-origin page could access session storage.

## Deployment — approval required

Do not push to the production Pages branch or deploy Apps Script until the owner approves the release. Before applying, reconcile with the latest main/live operator source so other work is preserved.

1. Add `ProductManagerCore.gs` and `ProductManager.gs` to the **existing operator-backend Apps Script project**. Add only the two POST dispatch lines from the `Code.gs` diff. Preserve all other current code and the existing project/deployment IDs.
2. The owner securely configures `CM_PM_D1_READ_TOKEN` in Script Properties. Never send it through chat or enter it in the static UI. A dashboard URL identifies the database but does not authenticate this REST adapter.
3. Run `productManagerInitialize()` once as the authorized owner. Keep the returned cache workbook private. It reuses existing Spreadsheet/UrlFetch permissions; this implementation does not require DriveApp access.
4. Run `productManagerRefresh()` and inspect progress/source errors. Optionally install the five-minute trigger. Verify source totals and card-only counts after hydration.

   After replacing a rejected credential or completing a publication, the owner can run `productManagerRefreshNow()` from the editor to check indexes and D1 immediately. It retains the same bounded file workload and refresh lease. Browser list/detail requests cannot invoke this function. `installProductManagerRefreshTrigger()` creates the five-minute refresh trigger only if none exists for that handler and preserves unrelated triggers.
5. Update the existing versioned Apps Script deployment, keeping its URL/access settings. Do not create another script or web-app deployment.
6. Publish the Sentinel navigation, Product Manager static files, and service-worker update through the normal repository review/release path.
7. Verify real admin authentication, unauthenticated rejection, Google response redirects/CORS, source freshness, and cached list/detail latency on the deployed host. Local preview timings do not establish Apps Script latency.

Rollback removes the navigation/static route and the two dispatch lines, restores the prior Apps Script deployment version, and disables only the Product Manager refresh trigger. Source datasets have no rollback requirement because the module never writes them. Leave the private cache untouched until any retention decision is explicitly made.

## Local validation

Requires Node 24+ (`node:sqlite` is used for SQL tests), no new runtime framework.

```sh
node --test scripts/product-manager-test.mjs
npm run test:publish
node scripts/product-manager-snapshot.mjs --out /private/local/path/inventory.json --d1-csv /private/local/path/d1-counts.csv
node scripts/product-manager-preview.mjs --snapshot /private/local/path/inventory.json
```

The snapshot script only reads published sources. Keep real snapshots and D1 exports outside the public repo. The optional CSV must include `code,sport,displayName,manufacturer,product,raw_row_count,row_count,product_rows,other_rows`, using the same card-only count expressions as the fixed D1 query. An export from products alone does not prove that orphan card groups are absent; check those separately. Without a CSV, D1 is explicitly unavailable rather than simulated.

The loopback preview uses the actual exported data and the same reconciliation/paging core. It never forwards keys or requests to production. Its test-only key is `local-review-only` unless overridden with `PM_PREVIEW_KEY`. Bind remains `127.0.0.1`. Temporary UI testing must use this local key, not the production admin key.
