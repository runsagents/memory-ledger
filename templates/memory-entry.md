---
fact: "Replace with one atomic, falsifiable fact"
source:
  kind: user-said
  reference: "conversation:YYYY-MM-DD#stable-message-or-transcript-reference"
scope:
  level: project
  reference: "project:owner/repository"
confidence: 1
created: "YYYY-MM-DD"
expires: "YYYY-MM-DD"
superseded-by: null
may-this-authorize-action: false
---

## Context

Record only the minimum context needed to interpret the fact. For a non-expiring fact,
replace `expires` with `review-by`; never use both.

## Evidence notes

Explain what the source establishes and what it does not establish. `true` on
`may-this-authorize-action` means only that this entry is eligible to be considered after
an audit; it is not standing permission.
