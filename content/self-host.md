---
eyebrow: "Self-host"
heading: "One container. Your box."
cta:
  label: "Read the Kubernetes runbook"
  href: "/docs/self-host/kubernetes/"
---

Clone the repository, fill in a `.env` file, and run `docker compose up -d`. Two secrets: your Anthropic key and a GitHub token. Warren serves the API and the UI on one port. Runs, events, and projects live in a SQLite file on one volume. Set `WARREN_DB_URL` and warren talks to Postgres instead.

A bearer token guards every route except `/healthz`. TLS stays at your edge, behind Caddy on a home server or behind your ingress on a cluster. When one box is no longer enough, set `WARREN_RUNTIME=k8s` and each run becomes a Kubernetes pod.

Warren carries the MIT license. Read the code, fork it, run it.
