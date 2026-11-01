# Print Run Lab

Upload a checklist PDF and a pack-odds PDF to see best-fit production estimates at `/print-run-lab/`. The tool is linked from the app and Command Center. Serve the repository over HTTP; JavaScript modules do not load through `file://`.

## Workflow

1. Upload the two PDFs or load the Topps Finest example.
2. Review extracted checklist groups, counts, pack formats and odds matches.
3. Review numbered anchors and their relative weights. Best-fit estimates appear automatically, including when anchors disagree.
4. Search parallel summaries or individual card estimates; export estimates and the supporting anchor calculations; save/reopen JSON projects.

## Domain assumptions and weights

A subject appearing on an autograph or memorabilia checklist does **not** establish that subject's presence in every parallel. A player might sign a Superfractor and other limited cards but not the base autograph, or the reverse. Consequently:

- Base and ordinary insert anchors start at weight **10**.
- Autograph, signature, relic, patch, swatch, jersey and memorabilia anchors start at weight **1**.
- These are editable influence heuristics, not measured probabilities. A particular Topps row can still be wrong regardless of its type.
- Enter a custom anchor weight between 0 and 1000. Blank means the type default; 0 or unchecking Use excludes it. Add a source-concern note explaining a change.
- Optionally override the eligible checklist count for a particular parallel when verified.

There are two optional automatic adjustments, both enabled by default and separately switchable:

1. **Coarse odds precision:** multiply the configured weight by `min(1,(smallest printed odds denominator/20)^2)`. Thus a format-exclusive 1:2 row gets a factor of 0.01, while 1:100 gets 1. This is a visible precision heuristic for rounded odds, not a statistical uncertainty calculation.
2. **Outlier influence:** Huber fitting with relative-error threshold 0.20. Disagreements larger than 20% reduce an anchor's effective weight smoothly. No source odds or checklist entries are rewritten, and anchors are never silently deleted.

The anchor table shows type, checklist-based copies, estimated copies, implied eligible subjects, discrepancy, configured weight, odds precision factor, final used weight and source notes. Differences above 5% are flagged for review; they **do not hide estimates**.

## Model

For an anchor family j, with eligible count Cj, known copies per card Sj, pack totals Pf and hit rate hjf:

`sum(Pf * hjf) ≈ Cj * Sj`

The pool is shared across every detected format. `1:N` means 1/N hits per pack; `N:1` means N hits per pack. A dash means unavailable.

The fit minimizes weighted relative discrepancies. With automatic outlier weighting disabled, the objective is `sum(weight_j * precision_j * (predicted_j / (Cj*Sj) - 1)^2)`. When enabled, the corresponding Huber relative-error loss is fitted by iteratively reweighted nonnegative least squares, with threshold 0.20. The active-set solver scales columns and its right-hand side before solving, so a large difference in physical pack totals does not itself imply redundant anchors. The angular conditioning estimate is exposed and sensitive allocations receive caution text; they are not suppressed solely because of a condition cutoff. A weight-refinement iteration cap results in a provisional label, not blank estimates.

Known format totals can be entered and are subtracted from the unknown system. If independent information is insufficient to allocate production across all formats, the interface explains which additional independent anchor or entered pack total is needed. It does not invent an unidentified pack mix. Structural column-mapping errors and actual solver failure also need correction. Invalid individual odds rows are marked separately while unaffected estimates remain available.

For every target parallel:

- Estimated copies contributed by each format = packs × hit rate.
- Estimated total copies = sum of those contributions.
- Estimated average copies per card = total / eligible count.

Known serial numbering is displayed separately. A result such as 0.8 copies per autograph checklist subject is an average over an assumed checklist, not a claim that an existing 1/1 card has fractional physical copies. The anchor table's implied eligible count helps expose missing membership or bad odds. Individual player short prints and actual parallel membership cannot be established from aggregate odds alone.

## Product configurations and the supplied Finest reference

Cards per pack and packs per box are optional editable fields for each format. Estimated boxes = estimated packs / packs per box. Summing the listed odds gives a soft cards-per-pack consistency check; rounded, incomplete or incorrect odds can differ from the declared pack contents. Configuration does not supply a production total by itself and is not used as another production anchor.

The example loader explicitly applies `finest-reference.js`, containing the user's supplied product breakdown:

- Hobby: 10 cards per pack, 6 packs per box.
- Breaker Delight: 10 cards per pack, 1 pack per box.
- Supplied serial numbering for Common/Uncommon/Rare parallels, ordinary inserts, the stated autograph families, Framed White /1 and 92 Finest /92.

This expands the example to **172 numbered anchors**. Source numbering is attributed as a user-supplied reference, separate from the PDFs. Missing numbering (for example Oil Spill) is left unspecified. This reference is applied only by Load Topps Finest example; arbitrary uploads do not inherit serial numbering from colors. Ordinary uploaded PDFs still automatically recognize Superfractors as assumed /1 anchors.

Reference product URL supplied in the conversation: https://www.dacardworld.com/sports-cards/2025-topps-finest-football-delight-box

Original example PDFs:
- https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2025_Topps_Finest_Checklist_042326.pdf?v=1776986521
- https://cdn.shopify.com/s/files/1/0871/8916/0120/files/2025_Topps_Finest_Football_Odds.pdf?v=1782311781

## Exports, projects and limitations

Parallel/card CSV includes estimate status, method assumptions, format pack and box estimates, and a reference to the separate anchor ledger. Export anchor calculations gives configured/used weights, source concerns and the detailed discrepancy ledger without repeating it for every card. Saved JSON retains edits, source text, custom weights/notes, automatic-weight settings, reference numbering and product configurations. Older projects without those additions receive the new defaults; the legacy scenario flag is retained for compatibility but does not control result visibility.

PDF.js 4.10.38 is vendored with its license. PDFs are processed in the browser without an upload server or CDN dependency. PDFs and project files over 30 MB are rejected.

The extractor supports selectable-text Topps-style uppercase section headings and odds tables headed by `Card`, the plural `Cards`, or `Component Description`. A `NumberedTo` column is read as serial metadata (not a pack format); when a sheet lists both pack and box odds for one population, each cell is read by its declared column role and physical position, so a box-odds column that precedes the pack column is not mistaken for pack odds — box odds are retained per row as `referenceBoxOdds` for reference only and never fitted as a second format. The active column layout (format/metadata/box roles and order) is refreshed at every accepted header, so a later header that adds or moves a `NumberedTo` column is honored. Wrapped headers whose channel qualifiers sit on a second line are folded into the format columns only when the first line looks like catalog/SKU noise and the qualifier items align under the header span, so an ordinary left-margin section label below the header does not overwrite the format names. When folding produces duplicate format names (ambiguous columns), estimates are blocked; duplicate names are re-checked live, so renaming a column to a unique name clears the block and a restored project cannot bypass it. Format labels keep ordinal/edition qualifiers (for example `1st Edition`) while leading catalog codes and `PACK ODDS`/`BOX ODDS` suffixes are trimmed. A repeated or reordered header is mapped by the active column order, and a return to the original order is handled. Scans need OCR. Genuinely ambiguous multi-channel layouts (e.g. two identically-labelled box channels) may still need manual review; do not assume a clean warning panel proves complete extraction.

Section headings: a numeric-led all-caps line is a heading only when the rows directly beneath it are a dash-form subset (`92 FINEST` → `92-1`, `1993 FINEST PROTOTYPES…` → `93A-AP`), and the look-ahead stops at the next section or heading, so a numeric card immediately before a new subset (`2 TOM BRADY PATRIOTS` before `INSERTS`/`RF-1`) is not lost. Mixed-case disclaimer prose is excluded; a genuine all-caps heading that contains `TOPPS` (`TOPPS TRIBUTE`, `TOPPS CHROME ULTRAVIOLET ALL STARS AUTOGRAPHS`) is kept. Title-case headings and some all-caps prefixed cards can still need review.

Classification and matching: each family carries the PDF's type section (`sectionKind`: Base, Insert, or Autograph/memorabilia). A known Base/Insert section sets the ordinary class; a family under an autograph/relic section defaults to weight 1 even without an autograph keyword in its name (e.g. "Italics"), and a name keyword can only escalate an ordinary family to the limited class, never downgrade one. Odds-to-section matching uses whole-word prefix and order-insensitive set matching (resolving "Base Cards Common" vs "Base Common Cards"); when two or more families tie for the best match the row is left unmatched and flagged ambiguous rather than silently assigned. Explicit user aliases (odds-name prefix → section) take priority, with the most specific alias winning. Aliases reference a section by its stable id, so renaming a section keeps its aliases valid; deleting a section drops its dependent aliases. Legacy name-based aliases in older saved projects are migrated to ids on restore. A manual section assignment is sticky and is never overwritten by automatic rematching, including alias edits; choosing "Unmatched" clears the override. Automatic matching is conservative, so not every odds row matches — for example a product's base family may be left unmatched when its odds name differs from the checklist; assign it or add an alias.

Derived values are finite-checked end to end: hit rates and whole-number eligible and copies-per-card counts are bounded, and every derived value (per-format copies, totals, discrepancies, implied eligible) is checked. Entered pack totals are not themselves capped, so a derived overflow is still possible; when any anchor or result value comes out non-finite it is detected, suppressed, isolated as an issue, forces the provisional state, and is never counted toward the "anchors agree within 5%" message. A format referenced by anchors but solved to zero is labelled a nonnegative-boundary allocation rather than presented as proof the format has no cards.

Card view/CSV omits groups whose extracted identity count differs from the eligible count; it never invents specific eligible player identities. Estimates cover detected formats only and assume equal production within the chosen eligible pool.

## Verification

Run `npm run test:print-run` with Node 22+ (Node 24 recommended). The current suite has 64 checks, including:

- Shared/exclusive pools, known totals and multiple formats.
- Estimates visible despite conflicting anchors.
- Hand-derived weighted least-squares optimum and editable source weights.
- Type defaults, outlier reductions and coarse-odds precision factors.
- Sensitive allocations, independent pools with different scales, and extreme-scale regression cases.
- Real source extraction and the explicitly supplied example numbering/configuration.
- Existing parser, matching and CSV regressions.
