---
eyebrow: "How it works"
heading: "Warren operates the loop"
steps:
  - stage: "Intake"
    title: "Queue the work"
    body: "Dispatch by hand, or do not: cron triggers, alerts, and the CI fixer start runs with no prompt from you."
  - stage: "Admission"
    title: "Warren admits what fits"
    body: "Admission control holds queue depth and per-project concurrency. Duplicate dispatches fold onto one run."
  - stage: "Runtime"
    title: "Warren contains the run"
    body: "Every run gets a fresh sandbox and a live spend cap. A watchdog reaps hung runs. You steer only to correct course."
  - stage: "Record"
    title: "Warren keeps the record"
    body: "Warren pushes the branch, opens the pull request, logs the run, and judges it. A run that dies mid-work still leaves its work behind."
---

Your judgment belongs in two artifacts: the issue before, the PR after. Warren operates everything in between.
