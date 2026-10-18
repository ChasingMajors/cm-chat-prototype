# Checklist import identity v7

A fresh SPx preview generated a different code from the existing source product. Checklist preview now resolves a unique existing identity using sport, year, manufacturer and product; conflicts or multiple candidates stop the write. Edition, language and season remain part of product/year identity. Row and parallel codes are rebound together to the selected code.

Both checklist clients submit the canonical target and a preview token. The backend reparses and validates the complete row/parallel fingerprint before writing, including changes that leave row counts unchanged. Source re-fetch and a second source-catalog identity check occur before source mutations. Existing transactional recovery and publishing remain in use.

All eleven regression suites pass, including new fixtures for duplicate identities, edition separation, mismatched tokens/targets, same-count source changes, canonical row/parallel binding and both HTML clients. Health version: 2026-10-18-checklist-import-identity-v7-r2. The previous deployed v6-r2 source is preserved in Git; an older open draft was separately preserved before updating.

The actual source-sheet reader is exercised by a regression fixture. Subset simplification removes only the enclosing product prefix: embedded years and brands such as 2022-23 UD Black Update and 2023-24 UD Black Update stay distinct, and All-Time punctuation is retained.

Version v7-r3 excludes pack-odds and serial-limit headings from card rows, keeps nested update-set identities, supports letter-only update card IDs and carries explicit subgroup serial defaults without overriding card-specific limits. Declared-count discrepancies are reported; they do not manufacture cards. Read-only previews can page through the full source in 500-row windows, with every page bound to the same complete source fingerprint and target. Twelve regression suites cover these cases.
