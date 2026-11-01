# Print Run Lab → Chasing Majors ecosystem integration

Status: design, not built. Grounded in the actual ecosystem code read on 2026-11-01
(paths cited inline). No code in the app/Sentinel repos has been changed. This doc
is the agreed plan before Batch 3; it is reviewable on its own.

Author intent (owner): Print Run Lab becomes the **source of truth** for Chasing
Majors print-run (PRV) and a **primary source** for checklist (CV) data —
replacing most of the SlabSquatch data pull with our own generated data, exposed
to users as "prove your work."

The honest version of that intent, given what the ecosystem already is:

> Print Run Lab is the **interactive, human-reviewed front end** for the PRV
> calculation pipeline that already exists. It does not become a second app, a
> second backend, or a second PRV calculator. It produces reviewed input
> artifacts that the existing, more-rigorous pipeline consumes and publishes.

---

## 1. What already exists (do not rebuild)

Read directly from disk; these are committed, working systems.

### 1.1 CV / PRV data plane
- Source of truth: Google Sheets → static JSON on GitHub Pages at
  `app.chasingmajors.com/data/v1` and `/data/v2`.
- Build: `chasing-majors-app/scripts/build-vault-data.cjs` reads each
  `data/prv-calculations/*.json`, runs `calculate(input)`, and emits the v2
  product + index with a content-hash filename and atomic publish.
- Read model: `shared/vault-model.js` already separates **print run**
  (`measurement.value` + `kind`), **serial limit** (`/N` ceiling), and
  **checklist size** — the exact distinction Print Run Lab makes.
- Identity: `shared/prv-cv-identity.cjs` `standardize(records, cv, policy)` links
  PRV rows to CV products; linking is exact-match-only (no fuzzy guesses).

> **Revision note (post Batch-3 validation).** An earlier draft implied Print
> Run Lab and the production PRV calculator are equivalent once they share a
> median formula, and proposed withholding Lab estimates on anchor disagreement.
> Both are corrected below: the production calculator is materially **stricter**
> (hard admission rules Lab does not enforce), and Lab's job is to keep
> best-effort estimates **visible** with the work shown — the strict gate lives
> only at the downstream publication boundary, not in the Lab preview.

### 1.2 The PRV calculation pipeline (the important one)
`chasing-majors-app/scripts/calculate-prv-odds.cjs` dispatches by
`schema_version`:
- `1` → odds/median-anchor calculator (in the same file)
- `2` → `calculate-prv-multiformat.cjs` (LP-bounded multi-format)
- `3` → `calculate-prv-numbered.cjs`

**This pipeline enforces strict publication-admission rules Print Run Lab does
not.** It requires Base-category anchors with serial limit **> 1**, odds
denominator **≥ 20**, **at least three** reviewed anchors, and a configured
spread limit (`calculate-prv-odds.cjs` lines ~18–29). Print Run Lab, by design,
accepts a single anchor, Superfractors, inserts/autographs, short odds, and
arbitrary disagreement — because Lab is an **exploratory review surface**, not
the publisher. Sharing the median formula does **not** make the two equivalent.
The point estimates Lab shows are internal-consistency fits, not validated
production. Specifically:
- **Anchor model.** Production packs are the **median of base-tier
  numbered-parallel implied packs**, where each anchor implies
  `subjects × serial_limit × odds_denominator` packs. It requires **≥3** reviewed
  Base anchors, rejects odds denominators `< 20`, and **withholds** when the
  anchor spread exceeds `method.max_anchor_spread` (`'Production anchors
  disagree'`). (`calculate-prv-odds.cjs`.)
- **Multi-format (schema 2).** Solves a bounded format mix and **publishes a value
  only when the relative width is within `max_relative_width` (≤ 0.1)**, with
  primal/dual **optimality certificates** verified in CI without a solver
  (`certifiedMinimum`). Otherwise `'Format mix is too uncertain to publish'`.
- **Provenance on every row.** Each row carries explicit notes — "Not
  manufacturer-confirmed," "Nominal serial limit … not a verified count," model
  range and rounding increment. It never presents an estimate as a confirmed
  total.

Print Run Lab **as of Batch 3** now defaults to the owner's bottom-up model:
**Total Packs = weighted median of serial-anchor implied packs** (weighted so the
base/insert > autograph influence policy and manual downweighting are honored),
each parallel = packs ÷ odds ÷ subjects, with the implied-packs range surfaced.
The two heuristics (coarse-odds, Huber) are now **experimental and off by
default**. So Lab's default and the production median-anchor method now agree on
the core formula. They still differ on **admission**: the production pipeline
refuses to publish rows that do not meet its strict rules; Lab shows them anyway,
flagged. That difference is intentional and is the subject of §5/§6.

### 1.3 Sentinel / Command Center (admin + publish authority)
- `command-center/operator-backend/Code.gs` (Apps Script) is the write
  authority. The admin credential is an **operator key** checked server-side,
  stored in `sessionStorage` (migrated out of `localStorage`), collected via the
  simple-agent UI. (Audit: `.agents/tasks/kiro-audit-sentinel-cv-prv.md` §2,
  S-4.)
- Publishing is atomic (`runAtomicGitHubPublish_`): one tree, one commit,
  non-forced ref update, pre-flight branch-move check, exact content + release-id
  verification against GitHub **and** the live CDN. This is the strongest part of
  the ecosystem; reuse it, do not reinvent it.
- Imports are recoverable (snapshot-before-mutate, post-write count validation,
  rollback). Mutations are never auto-retried.

### 1.4 Known ecosystem debt the integration must not worsen
From the audit:
- **Logic distribution (§X-1):** product-identity/normalize rules duplicated
  across 4+ components. A new consumer with its own rules makes this worse.
- **Endpoint drift (§X-2):** four consumers hard-code different Apps Script
  URLs. A new app is a fifth.
- Therefore: **do not add a parallel app/auth/endpoint.** Integrate through the
  existing seams.

---

## 2. The integration principle

Two trust tiers come out of Print Run Lab, and they travel different paths:

| Output | Trust today | Path | When |
|---|---|---|---|
| **Checklist / identity / numbering** (sections, card ids, set sizes, parallel `/N`) | High — deterministic, validated over 8 rounds | CV reviewed-import path | Now (after extraction review) |
| **Production estimates (PRV packs, copies/card)** | Provisional — uncalibrated heuristics | `data/prv-calculations/*.json` → `build-vault-data.cjs` | After Batch 3 + calibration |

Print Run Lab is a **producer of reviewed input artifacts**, not a publisher. The
existing pipeline remains the single calculator and the single publish authority.

---

## 3. Concrete seams

### 3.1 PRV estimate seam — emit `data/prv-calculations/<code>.json`
Target schema (read from `calculate-prv-odds.cjs` and a live input):
```
{ schema_version, code, meta, formats, sources, method, records/odds_rows, withheld, checklist_counts }
```
- `meta`: `{code, displayName, keywords, source_key, year, manufacturer, product, sport}`.
- `formats`: the detected pack-format vector (Print Run Lab already produces this).
- `records`/`odds_rows`: one per parallel, with `subjects`, `serial_limit`,
  `odds_by_format`/`odds_denominator`, `category`, `page`, `anchor`.
- `method`: the calculation contract (name, tolerances, rounding, calibration
  text). Lab's default is now the weighted-median serial-anchor method, which
  shares the pipeline's core formula. For a row to be **published** it must also
  satisfy the pipeline's strict admission rules (Base anchors, serial > 1, odds
  denominator ≥ 20, ≥ 3 anchors, spread within limit); a Lab row that does not
  is still shown in Lab but is marked **preview-only / not publication-eligible**
  in the export, not silently dropped.
- `sources`: odds/checklist/serial-reference URLs + SHA-256s (Lab already keeps
  source text; add the hashes).

**Round-trip acceptance (integration spike):** one product goes
`PDF → Print Run Lab → data/prv-calculations/<code>.json →
node scripts/build-vault-data.cjs → data/v2/vault/products/<slug>-<hash>.json →
renders in PRV` with values **identical** to running the pipeline's own
calculator on the same reviewed inputs. If Lab's export can't reproduce the
pipeline's numbers, the export is wrong — the pipeline is the oracle.

### 3.2 CV checklist seam — reviewed-import path (as an import candidate)
Print Run Lab's extracted sections/identities/numbering are an **import
candidate**, not unconditionally trusted data. Known extraction/matching limits
remain (e.g. the 2023 Pristine BASE family of 300 subjects is not matched; some
title-case/TOPPS headings and prefixed cards still need review). So the
extraction must pass explicit **completeness and identity checks** (expected vs
extracted counts, no unmatched/ambiguous rows left silently) before it enters CV.
With that gate, it feeds the CV reviewed-import path (`apply-reviewed-checklists.cjs` family), which already:
preserves populated source products, refuses identity/count mismatches, verifies
input checksums. Lab supplies the reviewed rows + a correction ledger (it already
has the ledger concept from the study prep). This is adoptable **now** because the
extraction is the validated half.

### 3.3 Auth / "admin-only upload & save" — reuse Sentinel's operator key
- **Do not** build a client-side password in the buildless page (security
  theater: the gate ships to every browser).
- The uploader and any save/publish are **admin actions** → they route through
  the Sentinel operator-key path (server-side Apps Script), the same authority
  that already gates every write. One credential, one write authority.
- Public users get the **read** experience: the "project name → dropdown" is the
  published CV/PRV catalog (static JSON), read-only. Users never receive a write
  capability.
- Export to users: fine and on-brand ("prove your work") — but the export must
  carry provenance (model version, which adjustments were on, baseline-vs-adjusted
  delta, withheld items, "not manufacturer-confirmed"). Lab's anchor-calculations
  CSV is already most of this ledger.

### 3.4 Independent checklist/odds upload + persistence
- Upload checklist alone → persisted reviewed-checklist artifact (CV seam).
- Upload odds alone → persisted; held until the matching checklist exists.
- When both exist for a product → compute → emit the PRV calculation artifact.
- Persistence is **server-side via Sentinel/the app repo**, not browser
  localStorage. "Projects" are products in the catalog.

---

## 4. What stays single-source (anti-divergence)

To avoid becoming debt §X-1/§X-2:
- **One published calculator.** The app repo's `calculate-prv-*.cjs` is the only
  math that *publishes*. Print Run Lab's `engine.js` `calculate` is a **preview**
  that shares the same core median-anchor formula; it is not required to be
  byte-identical to the publisher (Lab previews ineligible rows the publisher
  refuses), but a publication-eligible row's value must reproduce the publisher's
  output. The round-trip spike (§3.1) is where that equality is proven.
- **One identity module.** Reuse `shared/prv-cv-identity.cjs` / `vault-model.js`
  `key()` for product identity; Lab must not invent a new normalization.
- **One publish authority.** Sentinel. Print Run Lab never writes to the CDN.
- **One endpoint config.** Lab reads the same `data/v1`,`/v2` origins; it does not
  add a new Apps Script deployment.

---

## 5. Visible preview vs. strict publication (two different behaviors)

The owner's requirement is that Lab keeps **best-effort estimates visible** with
the concerns shown — never a blank result just because anchors disagree. The
production pipeline's requirement is that only rows meeting **strict admission
rules** get *published*. These are not in conflict; they are two stages:

- **Lab (preview):** show every estimate it can compute, with the implied-packs
  range, per-anchor ± vs known serial, conflicts, and clear provisional
  labeling. Do **not** withhold a Lab estimate on disagreement.
- **Publication boundary (export → `prv-calculations` → build):** each row is
  tagged **publication-eligible** only if it meets the pipeline's rules (Base
  anchors, serial > 1, odds denominator ≥ 20, ≥ 3 anchors, spread within limit).
  Ineligible rows still export (so the work is visible) but marked preview-only.

What Batch 3 delivered (done): the default is the owner's weighted-median
serial-anchor model; the two heuristics are experimental and off by default;
negative/non-finite production is rejected rather than reported as agreement; the
implied-packs range is surfaced. Still to do for the integration: the
publication-eligibility tagging above; per-row provenance in the export (model
version, adjustments used, "not manufacturer-confirmed"); and a
baseline-vs-adjusted delta when an experimental mode is toggled on.

PRV estimates graduate from "CM provisional estimate" to a SlabSquatch
*replacement* only after calibration against the owner's manually-built sheets
(target) and his sheets (cross-check). Until then they **augment / cross-check**
SlabSquatch, flagged provisional. Checklist/identity data can flow to CV sooner,
but only through the completeness/identity gate in §3.2 — it is an import
candidate, not unconditionally trusted.

---

## 6. Sequenced plan

1. **This doc** — align on the above. (done when approved)
2. **Batch 3 (done)** in `cm-chat-prototype/print-run-lab` — weighted-median
   serial-anchor default; heuristics experimental/off by default; negative and
   non-finite production rejected; implied-packs range surfaced. Finest example
   and study regressions stay locked. **Still pending** (follow-on): the
   publication-eligibility tag, export provenance, and the baseline-vs-adjusted
   delta when an experimental mode is on.
3. **Example library** — add the clean products (Chrome Black 2025, Finest
   Baseball 2024) as built-in examples, reference scoped like
   `finest-reference.js`. (parallel with Batch 3)
4. **PRV integration spike** — Lab exports a valid `data/prv-calculations/*.json`;
   prove one product round-trips through `build-vault-data.cjs` to a rendered PRV
   page with values identical to the pipeline's own output. No new app/auth.
5. **CV checklist adoption** — route Lab's extraction through the reviewed-import
   path for one product; adopt as a primary CV source.
6. **Calibration + supervised multi-product testing** — gate PRV estimates
   graduating from provisional to SlabSquatch replacement.
7. **Admin wiring** — upload/save/publish through Sentinel's operator key; public
   read via the catalog dropdown; user export with provenance.

---

## 7. Open decisions for the owner

- **Canonical app working copy.** The live deploy is a *different build* than the
  local tree (per the PRV-404 diagnosis). Which working copy of `chasing-majors-app`
  is canonical for edits? Nothing in that repo or Sentinel is touched until this
  is confirmed.
- **Replace vs augment SlabSquatch.** Confirm: PRV estimates start as
  augment/cross-check (provisional-flagged) and graduate to replacement only after
  calibration. (Strongly recommended.)
- **Calibration product.** Identify at least one product with an independently
  documented print run to calibrate the model before any replacement claim.
- **Where Print Run Lab finally lives.** Reframed as the PRV pipeline's review
  front end, it most naturally belongs *in the app repo* alongside the calculators
  it previews, sharing their modules — rather than remaining a standalone tool in
  `cm-chat-prototype`. Decide whether to move/port it there as part of the spike.
