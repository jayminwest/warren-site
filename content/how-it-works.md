---
eyebrow: "How it works"
heading: "From a prompt to a pull request"
steps:
  - stage: "Project"
    title: "Add a repository"
    body: "Give warren a GitHub URL. Warren clones it onto its own volume."
  - stage: "Dispatch"
    title: "Pick an agent, write a prompt"
    body: "The claude-code, sapling, and pi agents ship inside the image. Point warren at a prompt library and your own agents replace the built-ins by name."
  - stage: "Run"
    title: "Watch and steer"
    body: "The agent works inside a sandbox. Events stream as NDJSON, and a message you send mid-run reaches the agent on its next turn."
  - stage: "Result"
    title: "Take the branch"
    body: "Warren pushes the workspace branch and opens a pull request. The sandbox goes away with the run."
---

Four stages, one path. The web UI, the `warren` CLI, and the HTTP API all take it, so a nightly trigger and a hand-typed prompt behave the same way.
