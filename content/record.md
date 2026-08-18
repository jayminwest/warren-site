---
eyebrow: "System of record"
heading: "Conversations evaporate. Runs leave a record."
---

Every run leaves an episode: trajectory, outcome, gate results, judge verdict. A chat leaves nothing.

The audit-log extension writes every run event to an append-only log and serves it at `GET /audit-log.jsonl`. The judge extension scores every finished run against a 15-class rubric and serves the verdicts at `GET /verdicts.jsonl`.

The judge runs isolated from the agents, and an agent never sees its verdict. The thing the metric measures cannot game the metric. Over time, the record answers a question no chat can: which task classes need a frontier model, and which do not.
