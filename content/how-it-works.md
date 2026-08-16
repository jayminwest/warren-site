---
eyebrow: "How it works"
heading: "From a prompt to a pull request"
steps:
  - stage: "Project"
    title: "Add a repository"
    body: "Give warren a GitHub URL. Warren clones it onto its own volume."
  - stage: "Dispatch"
    title: "Pick an agent, write a prompt"
    body: "The claude-code, sapling, and pi agents ship in the image. Five more built-in agents plan, triage, and repair."
  - stage: "Run"
    title: "Watch and steer"
    body: "The agent works in a sandbox while every event streams to your browser. Send a message mid-run and the agent reads it on its next turn."
  - stage: "Result"
    title: "Take the branch"
    body: "Warren pushes the branch and opens a pull request. The sandbox goes away with the run."
---

Four stages, one path. The web UI, the `warren` CLI, and the HTTP API all follow it, so a cron trigger and a hand-typed prompt behave the same way.
