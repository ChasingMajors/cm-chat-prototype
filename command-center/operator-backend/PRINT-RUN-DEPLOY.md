# Print Run Lab deployment

The Lab uses the existing Sentinel Operator project and deployment. Do not create another operator key or replace unrelated live files.

Confirmed on 2026-11-01:

- Editor: https://script.google.com/home/projects/1KwtTL1chM-WceAHaTJHGtuTluzJq8Re2wuJX7TcvqP0OomDlqGol-ha2/edit
- Existing deployment: `AKfycbyH90r_uVKKVyEUPAzQv65PlMC7j6LGYxq3s2HWAjBwkpTsLOo8U7KPhBWCD-6ExRjc`
- Deployment version before this work: 113.
- Live files include `ReviewedMaintenance.gs`, which is absent from this checkout. Preserve it.
- The editor's Code.gs differs slightly from HEAD in existing health/monitor routing. Apply the Lab additions to its existing source; do not replace it wholesale from the checkout.

## Backend first

1. Run `node scripts/build-print-run-server.mjs --check`. The generated `PrintRunModel.gs` contains the exact unchanged calculation engine and the public-project schema.
2. Back up the existing editor source. Add the three authenticated POST routes and GET rejection from the Code.gs diff, preserving the other routes.
3. Add `PrintRunModel.gs` and `PrintRunProjects.gs` as script files. Save, then update the existing deployment to a new version. Preserve its URL, execute-as setting and access setting. Version 113 is the pre-change rollback target.
4. Keep the existing `CM_OPERATOR_KEY` and `CM_GITHUB_TOKEN` private. Never put them in code, a URL, a public project, or a deployment report.
5. Authoring capability works after authenticated verification. Publishing remains disabled unless Script Property `CM_PRL_PUBLISH_ENABLED` is exactly `true`. Enable it only after confirming the existing token can write contents in `ChasingMajors/cm-chat-prototype`, and read its Actions status. Do not expand token permissions silently.
6. Verify all three Lab admin actions reject unauthenticated POST and reject GET. A 200 response alone does not establish authorization: inspect the JSON `ok` value.

## Frontend and catalog

Deploy the app, operator client, generated model-version file, schema, catalog adapter and empty `data/print-run-lab/v1/index.json` through the repository's existing main-branch GitHub Pages deployment. Run the existing 81 calculation checks plus `test:print-run-access` and `test:print-run-publish` first. The CI workflow also checks each revision listed in the current catalog against its schema and byte hash. A pushed branch and PR provide review and CI; they do not automatically create a Pages preview. Merge and live backend deployment require the owner's approval.

Public viewing, project selection, JSON/CSV exports and the built-in example need no key. Uploaders and local Save/Open mount only after server verification. Published revisions remain frozen until the owner explicitly edits a copy. Logout returns to the public snapshot.

Local Save downloads a draft; Publish creates one immutable public revision and updates the shared index in one non-forced Git commit. Publishing requires an explicit public-sharing review: the allowlisted project still contains source text, reviewed notes and player/checklist information. Source layout coordinates, local directory paths, unknown fields and credentials are removed. PDFs are not uploaded.

Publication receipts distinguish repository commit, deployment pending, uncertain delivery and live verification. Success requires the matching commit's checks, Pages deployment, public catalog and revision byte hash. Do not repeat Publish following an uncertain response; use the saved receipt to check status. A manual rollback is a reviewed Git revert, followed by Pages verification.

## Owner acceptance

Use the existing key directly in the Lab's password field; never send it in chat. Verify a rejected key cannot mount file inputs, public exports still work, a reviewed project can publish, and a fresh signed-out browser can select its frozen revision. Do not publish the Finest example automatically as an owner-reviewed product.

Every published Lab revision is `provisional` and `not-yet-calibrated`. This catalog does not publish to PRV, Checklist Vault, Sheets or D1. Calibration against the owner's Bowman/Topps sheets remains separate.
