# Offline owner comparisons

These fixtures and reports are siblings of published projects. They do not change engine inputs, frozen calculations, publication eligibility or the pinned `provisional` / `not-yet-calibrated` statuses. The comparator reads local files only; it has no publishing or network operation.

Run from the repository root:

```sh
node scripts/print-run-calibrate.mjs \
  --artifact data/print-run-lab/v1/projects/prl_b1926b31-f6a0-4824-a12c-21d83edc5bbb/354eb262-3c08-4fe0-97f7-524a5047a1e2-dfe5e7d96619.json \
  --fixture data/print-run-lab/v1/calibration/2023-bowman-sapphire-mlb.json
```

The default output is `reports/<set-slug>-<revision-id>.json` under this directory. An optional `--out` must stay inside that reports directory and cannot overwrite either input. Reports include project/revision IDs, engine version/hash, artifact/fixture byte hashes, source provenance, unmatched targets and source cautions. Exit codes: 0 for PASS, 1 for FAIL or INCOMPLETE, 2 for invalid input or execution errors.

## Identity and units

A checklist family can contain several parallel rows in the same pack format. Fixtures therefore name its real `family_id`, the parallel's stable `row_id`, and the exact format. The `{from,to}` aliases explicitly associate owner labels with checklist family IDs. A legacy target without IDs can resolve through an exact alias and exact parallel-name match. The comparator does not normalize labels or fuzzy-match. Unknown or ambiguous targets, conflicting aliases and mismatched eligible counts remain unmatched.

Aggregate `total_packs` uses packs as its unit. Per-parallel `copies_per_card` uses the frozen `perCard` value for a single-format project, or that format's frozen copies divided by eligible subjects for a multi-format project. It never compares pack totals with copies or combines separate formats silently. Fixture values are the owner's displayed `Calc PR` numbers, so their rounding remains visible.

PASS requires a median-method snapshot, complete fixture coverage and aggregate absolute relative error no greater than 5%. Per-parallel errors above 10% are advisory and do not independently fail the comparison. Every comparison includes signed and absolute copy differences; targets of two copies or fewer are explicitly marked as tiny denominators. Zero per-card targets have no relative percentage and retain their absolute difference.

## 2023 Bowman Sapphire

The correct set slug is `2023-bowman-sapphire-mlb`, correcting the design report's 2025 placeholder. The owner source is the published workbook titled `23 Bowman Sapphire MLB`, gid=0. Its unrelated `2025 Definitive MLB` heading is not product provenance. All 13 source denominators agree with the official 2023 odds PDF. The second tab contains a different product's odds and is not part of this fixture. The independent Topps2025Series2Odds cross-check remains null because its URL was not supplied.

The project has two families (150 base and 29 autograph identities), one pack population, and 13 published odds rows. Box odds are reference only. An additional ordinary base row deliberately has blank odds, is unanchored, and has no estimate. The historical 1900 value is not used.

Twelve anchors use Topps's explicit NumberedTo values. The ordinary autograph's `199` is an unconfirmed owner-sheet value, included by request with relative weight 0.1 versus the existing autograph default 1 and base default 10. That weight was chosen as a low influence for an unconfirmed input, not fitted to the 80000 target. Neither pack totals nor experimental weighting were overridden.

The published baseline is 81490 packs, compared with the owner's 80000: +1.8625%, PASS. Its full anchor-implied range is 78900–152163; the upper value comes from the Aqua autograph anchor. The ordinary base coverage gap and autograph source discrepancy remain visible despite the comparison PASS. The six-base-anchor example, 81750 versus 80000 = +2.1875% (rounded +2.19%), is a separate regression test, not the result forced onto this project.

Fixtures pin an immutable baseline path/revision/hash for regression evidence. The CLI can compare a later revision of the same project and model without changing that baseline; it writes a separate report. Published artifacts remain provisional even when a sibling comparison passes.

Run `npm run test:print-run-calibrate` for identity, ambiguity, thresholds, units, source immutability, CLI behavior and the actual baseline checks.
