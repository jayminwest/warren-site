---
eyebrow: "Ecosystem"
heading: "Extensions"
title: "Warren extensions"
description: "Opt-in extensions consume Warren run records from outside the server process. Browse the public catalog."
entries:
  - name: "audit-log"
    kind: "Observer"
    status: "Shipped"
    summary: "An append-only audit trail of run activity. It records each dispatch, each state change, and each pushed branch. It exports the trail as JSON lines."
    href: "https://github.com/jayminwest/warren/tree/main/extensions/audit-log"
  - name: "judge"
    kind: "Observer"
    status: "Shipped"
    summary: "An LLM judge for finished runs. It scores each run against a behavioral rubric, stores every verdict append-only, and exports the verdicts as JSON lines."
    href: "https://github.com/jayminwest/warren/tree/main/extensions/judge"
designDoc:
  label: "Read the design record"
  href: "https://github.com/jayminwest/warren/blob/main/docs/design/extensions.md"
propose:
  label: "Propose an extension"
  href: "https://github.com/jayminwest/warren/issues/new"
---

Extensions are optional. Warren keeps the base run path small, and an extension runs next to the service with its own storage and release cycle. Warren never loads third-party code into the server process.

There are two kinds. An observer reads the run lifecycle over the HTTP API and never blocks a run. Audit trails, notification sinks, and activity feeds are observers. A provider implements a warren contract behind a versioned wire protocol, so warren can call an external service for a whole capability. Issue trackers are the first provider boundary. Future external tracker implementations can use that boundary without joining core.

This page is the public catalog. Each entry names what the extension does, what it consumes, and where its source lives. The packaging contract is young, so the catalog starts small. The design record below tracks the contract as it settles.
