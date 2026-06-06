# Chasing Majors Operator Backend Deployment

This backend powers the Command Center source-watch tools.

It can run review-only checks and, after an admin write key is configured, approved Google Sheet writes.

## What It Does

- Checks recent Checklistcenter product pages.
- Keeps only baseball, football, basketball, hockey, and soccer.
- Ignores MMA, UFC, WWE, racing, Pokemon, Marvel, and other non-sports-card categories.
- Compares source products against live Chasing Majors checklist data.
- Builds an import preview from a supported Checklistcenter product page.
- Writes approved imports to the mapped Chasing Majors Google Sheet.
- Validates that the product row, checklist rows, and parallel rows were written.
- Scans supported SlabSquatch posts for PRV review work.
- Publishes approved PRV JSON through Static Data Exporter.
- Records scheduled PRV sync failures as Sentinel incidents instead of leaving them as vague admin emails.
- Reports products as:
  - covered
  - missing
  - needs review
  - ignored

## Add The Admin Write Key

Before using `Write to Google Sheet`, add a Script Property.

1. Open the Apps Script project.
2. Click `Project Settings`.
3. Under `Script properties`, click `Add script property`.
4. Add:

   `CM_OPERATOR_KEY`

5. Set the value to a private key phrase only you know.
6. Click `Save script properties`.

Use that same value in Command Center as the `Admin write key`.

## Connect Static Data Exporter Publishing

The Command Center Operator writes the Google Sheet. The Static Data Exporter publishes GitHub JSON and validates the public files.

1. Update the Static Data Exporter Apps Script with the latest:

   `/Users/chasingmajors/Desktop/CM App/Static Data Exporter code.gs`

2. Deploy Static Data Exporter as a Web App.

3. In the Static Data Exporter Apps Script project, add the same Script Property:

   `CM_OPERATOR_KEY`

4. In the Command Center Operator Apps Script project, add this Script Property:

   `CM_STATIC_EXPORTER_URL`

5. Set `CM_STATIC_EXPORTER_URL` to the Static Data Exporter Web App URL ending in `/exec`.

After this is configured, approved imports run:

`Preview -> Sheet write -> publish JSON -> rebuild index -> validate public Checklist Vault and ChatBot data`

For PRV, approved work runs:

`PRV preview -> PRV Sheet write -> PRV JSON publish -> public PRV validation`

For safer PRV time triggers, update Static Data Exporter and run:

`installVaultStaticDataGitHubTriggers`

That installs triggers against:

`publishVaultStaticDataToGitHubScheduled`

The scheduled wrapper uses a lock and catches normal publish failures. Use `publishVaultStaticDataToGitHub` or Command Center `Sync PRV JSON` for direct manual syncs.

## Create The Apps Script Project

1. Go to:

   `https://script.google.com`

2. Click `New project`.

3. Rename the project:

   `CM Command Center Operator`

4. Delete the starter code.

5. Paste the full contents of:

   `command-center/operator-backend/Code.gs`

6. Click `Save`.

## Deploy As Web App

1. Click `Deploy`.

2. Click `New deployment`.

3. Click the gear icon next to `Select type`.

4. Choose `Web app`.

5. Set `Description` to:

   `Command Center Operator v2`

6. Set `Execute as` to:

   `Me`

7. Set `Who has access` to:

   `Anyone`

8. Click `Deploy`.

9. Approve permissions if Google asks.

10. Copy the Web app URL.

## Connect It To Command Center

1. Open the sandbox Command Center:

   `https://chasingmajors.github.io/cm-chat-prototype/command-center/`

2. Paste the Web app URL into:

   `Optional Apps Script Operator Backend URL`

3. Paste the same Script Property value into:

   `Admin write key`

4. Click:

   `Save Endpoint`

5. Click one of the Source Watch buttons:

   `Quick JSON Source Watch`

   or

   `Deep Sheets Source Watch`

## Test URLs

After deployment, these URLs should return JSON:

Health check:

`YOUR_WEB_APP_URL?action=health`

Source watch:

`YOUR_WEB_APP_URL?action=sourceWatch`

Quick JSON source watch:

`YOUR_WEB_APP_URL?action=sourceWatch&mode=quick_json`

Deep Google Sheets source watch:

`YOUR_WEB_APP_URL?action=sourceWatch&mode=deep_sheets`

Single product validation:

`YOUR_WEB_APP_URL?action=validateSourceProduct&title=2025-26%20Topps%20Merlin%20Premier%20League%20Soccer&sport=soccer`

Import preview:

`YOUR_WEB_APP_URL?action=previewSourceImport&sourceUrl=https%3A%2F%2Fwww.checklistcenter.com%2F2025-26-panini-noir-road-to-fifa-world-cup-26-soccer-card-checklist%2F&sport=soccer`

PRV source watch:

`YOUR_WEB_APP_URL?action=prvSourceWatch`

PRV JSON sync:

`YOUR_WEB_APP_URL?action=publishPrvVaultStaticData&key=YOUR_ADMIN_KEY`

Scheduled PRV sync with Sentinel memory:

`YOUR_WEB_APP_URL?action=runScheduledPrvSync&key=YOUR_ADMIN_KEY`

## Important Safety Note

Approved execution updates matching product-code rows in Google Sheets, appends new rows, publishes GitHub JSON through Static Data Exporter, rebuilds the checklist index, and validates public JSON.

The operator must not clear whole sheets or delete unrelated product data.

Current flow:

`Find source update -> preview import -> admin clicks Write -> update Sheet -> publish JSON -> validate Checklist Vault and ChatBot data files`

Next phase:

`Find source update -> preview import -> admin clicks Write -> update Sheet -> publish JSON -> validate live app page rendering`
