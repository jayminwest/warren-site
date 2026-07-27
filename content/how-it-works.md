---
eyebrow: "How it works"
heading: "From a prompt to a pull request"
---

1. **Add a project.** Give warren a GitHub URL. Warren clones the repository onto its own volume.
2. **Dispatch a run.** Pick an agent and write a prompt. Send it from the web UI, from the `warren` CLI, or straight to the HTTP API. All three take the same path through warren.
3. **Watch and steer.** Events stream as NDJSON while the agent works. Send a message mid-run and the agent reads it on its next turn. Cancel the run and warren stops it cleanly.
4. **Take the branch.** Warren pushes the workspace branch and opens a pull request. The sandbox goes away with the run.
