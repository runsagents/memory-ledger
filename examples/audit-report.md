# Memory ledger audit

- Directory: `examples/memories`
- As of: `2026-07-14`
- Trust context: `project:github.com/runsagents/memory-ledger`
- Result: **REVIEW REQUIRED**

## Summary

| Check | Count |
| --- | ---: |
| Entries scanned | 4 |
| Invalid entries | 0 |
| Expired entries | 1 |
| Review overdue | 0 |
| Missing sources | 0 |
| Scope violations | 0 |
| Superseded entries | 1 |
| Broken supersession chains | 0 |
| Action-eligible entries | 1 |

## Invalid entries

- None.

## Expired or overdue

- `02-expired-release-approval.md` expired after `2026-06-30`; do not trust it or let it authorize action.

## Missing sources

- None.

## Scope violations

- None.

## Supersession chains

- `03-old-test-command.md` → `04-current-test-command.md`

## Broken supersession chains

- None.

## Action-authorizing review

- `04-current-test-command.md` is structurally eligible, current, and in scope. Re-read its source before acting; the flag is not standing permission.
