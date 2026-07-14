Memory is convenient in prototypes; at production stakes, unqualified memory is hidden state.
Memory that may influence an action is authorization state and needs stronger provenance.

# memory-ledger

## A stale approval becomes an incident

Consider a generic failure mode: a user approves a release for a limited window. An agent saves
“release approved,” drops the date and conversation reference, then finds the phrase weeks later
and publishes. The model followed its memory faithfully; the memory had silently outlived the
approval.

That is a composite, illustrative story—not a claim about a particular user, company, or
production incident. The lesson is concrete: every remembered fact is a liability unless it
carries source, scope, and expiry.

`memory-ledger`, from Shakhzod at runsagents, is a zero-dependency format and audit tool for agent
memory with source, scope, confidence, expiry, supersession, and explicit action-authorization
eligibility.

## Entry anatomy

Each file in a `memories/` directory is Markdown with constrained YAML frontmatter. Start from
[`templates/memory-entry.md`](templates/memory-entry.md); the complete data contract is
[`schemas/memory-entry.schema.json`](schemas/memory-entry.schema.json).

| Field | Why it exists |
| --- | --- |
| `fact` | Stores one atomic claim so it can be verified or replaced without dragging unrelated claims with it. |
| `source.kind` | Distinguishes `user-said`, `observed`, and `inferred`; these are not equally authoritative. |
| `source.reference` | Points back to a durable conversation, file, URL, command output, or inference basis. “The user said so” is not enough. |
| `scope.level` | Says whether a fact is valid for one `project` or truly `global`. |
| `scope.reference` | Names the project boundary. It is required for project scope and forbidden for global scope. |
| `confidence` | Records epistemic uncertainty from `0` to `1`; it does not override weak provenance. |
| `created` | Makes the age of a memory visible. |
| `expires` / `review-by` | Requires exactly one time horizon: hard invalidation or a mandatory re-check. |
| `superseded-by` | Preserves history while directing readers to the replacement entry. |
| `may-this-authorize-action` | Separates descriptive context from memory that is eligible to influence an action. `true` is not standing permission. |

The Markdown body is for narrow context and evidence notes. The auditor makes decisions from the
frontmatter, not from prose.

## Install and audit the examples

Requirements: Node.js 20 or newer. There are no runtime or development dependencies and no build
step: place this directory in your project or use it directly from a checkout.

```sh
npm test
node scripts/validate-entry.mjs examples/memories/*.md
node scripts/audit-ledger.mjs examples/memories \
  --as-of 2026-07-14 \
  --scope project:github.com/runsagents/memory-ledger
```

The example ledger is explicitly synthetic. Its expired approval is intentional, so the audit
prints this real output and exits `1` to make the review requirement automation-visible:

```text
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
```

Use `--output audit-report.md` to write the same Markdown report. Without `--as-of`, the auditor
uses the current UTC date. Without `--scope`, it checks scope structure but cannot detect use in
the wrong project.

## The may-authorize-action rule

`may-this-authorize-action: false` means the memory must never be used as authority to mutate
files, call services, spend money, publish, message people, or perform another consequential
action.

`true` makes an entry only *eligible for consideration*. The validator additionally requires:

- a `user-said` or `observed` source—never an inference;
- a concrete, retrievable source reference;
- project scope with an exact project reference;
- confidence of at least `0.9`; and
- an explicit `expires` date rather than a softer `review-by` date.

Before acting, run the audit in the actual project scope, confirm the candidate appears under
“Action-authorizing review,” follow any supersession chain, and re-read the cited source. An
expired, overdue, invalid, out-of-scope, missing-source, or superseded entry cannot authorize an
action. The flag never expands the agent's current permissions and never replaces fresh approval
when the action or surrounding circumstances require it.

## Limitations

- The YAML reader intentionally accepts only this template's small subset: scalar values and
  one-level `source`/`scope` objects. It is not a general YAML parser.
- References are checked for presence and obvious placeholders, not fetched or authenticated.
- Confidence is self-reported metadata, not calibrated probability.
- Expiry uses calendar dates in UTC and treats an entry as valid through its listed date.
- The auditor detects file-level chains, missing targets, and cycles; it does not decide whether
  two facts are semantically contradictory.
- A clean audit is evidence about ledger hygiene, not proof that a fact is true or an action is
  safe, legal, permitted, or desirable.
- Concurrent writers still need ordinary version-control or locking discipline.

## Attribution

The state-discipline inspiration is credited to HumanLayer's
[12-Factor Agents](https://github.com/humanlayer/12-factor-agents), especially the ideas of owning
the context window and making state explicit. This project is an independent implementation; no
12-Factor Agents code or text is included. See [`ATTRIBUTION.md`](ATTRIBUTION.md).

Released under [CC0 1.0 Universal](LICENSE).

## Terminology & prior art
This pattern uses [data provenance](https://www.w3.org/TR/prov-o/), related to [agent memory streams](https://arxiv.org/abs/2304.03442).
This implementation adds scope, expiry, and an explicit flag controlling whether a memory may authorize action.
