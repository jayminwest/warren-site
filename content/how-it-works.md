---
eyebrow: "How it works"
heading: "Warren operates the run"
steps:
  - stage: "Workspace"
    title: "Prepare the work"
    body: "Warren refreshes the repository, creates a run branch, and materializes a disposable workspace."
  - stage: "Runtime"
    title: "Start the workload"
    body: "Warren starts the selected harness in a sandbox on one box, in Docker, or in a Kubernetes pod."
  - stage: "Control"
    title: "Observe and intervene"
    body: "Live events, spend limits, and cancellation keep the run visible. Runtimes that support steering also accept corrections."
  - stage: "Delivery"
    title: "Recover and deliver"
    body: "Warren preserves recoverable work, pushes the branch, and can open a pull request when the forge supports it."
---

You define the task and review the change. Warren operates the run between those decisions.
