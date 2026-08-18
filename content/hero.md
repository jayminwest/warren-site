---
eyebrow: "Open source · self-hosted · MIT"
headline: "The self-hosted control plane for coding agents."
title: "Warren: the self-hosted control plane for coding agents"
description: "Warren is the self-hosted control plane for coding agents. Issue in, PR out. Your infra, your keys. Sandboxed runs, spend caps, an audit log, and judge verdicts. One container, MIT."
demoCta:
  label: "Watch it live"
  note: "app.warren.run · real runs, no login"
  href: "https://app.warren.run"
primaryCta:
  label: "Star warren on GitHub"
  href: "https://github.com/jayminwest/warren"
secondaryCta:
  label: "Read the quickstart"
  href: "/docs/quickstart/"
---

Issue in, PR out. Your infra, your keys.

<pre><code><span>export ANTHROPIC_API_KEY=sk-ant-...</span>
<span>export GITHUB_TOKEN=ghp_...</span>

<span>docker run -d --name warren -p 8080:8080 \</span>
<span>  -v /var/run/docker.sock:/var/run/docker.sock \</span>
<span>  -v "$(command -v docker)":/usr/bin/docker:ro \</span>
<span>  -v /srv/warren:/srv/warren \</span>
<span>  -e WARREN_RUNTIME=docker -e WARREN_DATA_DIR=/srv/warren \</span>
<span>  -e ANTHROPIC_API_KEY -e GITHUB_TOKEN \</span>
<span>  ghcr.io/jayminwest/warren:latest</span></code></pre>
