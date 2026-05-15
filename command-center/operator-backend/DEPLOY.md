# Chasing Majors Operator Backend Deployment

This backend powers the Command Center source-watch tools.

It is safe to deploy now because this first version is review-only. It does not update Google Sheets, GitHub, Apps Script files, or live app data.

## What It Does

- Checks recent Checklistcenter product pages.
- Keeps only baseball, football, basketball, hockey, and soccer.
- Ignores MMA, UFC, WWE, racing, Pokemon, Marvel, and other non-sports-card categories.
- Compares source products against live Chasing Majors checklist data.
- Reports products as:
  - covered
  - missing
  - needs review
  - ignored

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

   `Command Center Operator v1`

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

3. Click:

   `Save Endpoint`

4. Click:

   `Run Source Watch`

## Test URLs

After deployment, these URLs should return JSON:

Health check:

`YOUR_WEB_APP_URL?action=health`

Source watch:

`YOUR_WEB_APP_URL?action=sourceWatch`

Single product validation:

`YOUR_WEB_APP_URL?action=validateSourceProduct&title=2025-26%20Topps%20Merlin%20Premier%20League%20Soccer&sport=soccer`

## Important Safety Note

This version is review-only.

The next phase is approved execution:

`Find source update -> show recommendation -> admin clicks Go -> update Sheet -> publish JSON -> validate result`

