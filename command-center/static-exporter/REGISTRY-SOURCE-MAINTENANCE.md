# Owner-only CV/PRV metadata maintenance

`RegistrySourceMaintenance.gs` runs in the existing Static Data Exporter project.
It adds no public action or scheduled trigger. The public v2 registry remains the
canonical identity contract; legacy authoring codes are retained for source-scoped
reviews and aliases.

Run `registrySourcePreflight` before `registrySourceApply`. The planner matches
reviewed names, seasons and sports, rejects ambiguous identities and unknown
formulas, then simulates reconciliation to require unchanged source row routing.
It changes only display name, year, sport, manufacturer and product family. Four
explicit CV source corrections are independently guarded against their old values.

Before writes, Apply saves and reads back a private Drive JSON backup named
`registry-source-metadata-backup-<timestamp>.json`. It verifies the resulting cells,
row routing and every non-metadata PRV value. Failed verification restores the
written values and formulas. `registrySourceFormulaAudit` independently compares
the latest backup with current source values/formulas and logs a bounded summary.
A rollback is not considered verified until that audit reports zero mismatches.

Re-run Preflight after a successful Apply: zero planned changes establishes
idempotence. Repository-calculated products without source Sheet rows are reported
separately; this tool does not fabricate those rows or CV checklist coverage.

Some Products Code cells are formulas over D/F/G/E. Updating metadata can otherwise
silently regenerate those identifiers. For the one recognized Code formula shape,
maintenance wraps the original expression with an exact metadata guard returning
the existing legacy code. The original expression is retained as fallback and in
the private backup. Unknown Code formulas abort before any writes. Display-name
formulas receive a corresponding code/year guard, retaining their original fallback.
`CM_REGISTRY_SOURCE_LAST_BACKUP` stores only the backup file ID, never credentials.
