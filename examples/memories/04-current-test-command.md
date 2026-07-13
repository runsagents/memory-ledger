---
fact: "Run the repository test suite with `npm test`; this invokes Node's built-in test runner."
source:
  kind: observed
  reference: "synthetic-repository-snapshot:package.json@v1.0.0#scripts.test"
scope:
  level: project
  reference: "github.com/runsagents/memory-ledger"
confidence: 1
created: "2026-07-14"
expires: "2026-10-14"
superseded-by: null
may-this-authorize-action: true
synthetic: true
---

> Synthetic example.

This may authorize only the local, project-scoped test command after the ledger audit passes
for this entry. It does not authorize publishing, installing dependencies, or network access.
