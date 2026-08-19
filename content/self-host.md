---
eyebrow: "Self-host"
heading: "One container. Your box."
cta:
  label: "Read the Kubernetes runbook"
  href: "/docs/self-host/kubernetes/"
---

Clone the repository, fill in a `.env` file, and run `docker compose up -d`. Two secrets: your Anthropic key and a GitHub token. SQLite by default, Postgres when you want it.

A bearer token guards every route. TLS stays at your edge. When one box is no longer enough, set `WARREN_RUNTIME=k8s` and each run becomes a Kubernetes pod.

Warren carries the MIT license. Read the code, fork it, run it.
