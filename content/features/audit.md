---
order: 5
eyebrow: "Audit"
glyph: "receipt"
title: "An append-only audit log"
---

The audit-log extension records every run event: each dispatch, each state change, each pushed branch. Nothing edits the log after the fact. Read the whole trail as JSON lines at `GET /audit-log.jsonl`.
