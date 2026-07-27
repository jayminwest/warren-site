---
order: 2
eyebrow: "Sandbox"
title: "Every run is sandboxed"
---

On a single host, each run gets a fresh `bwrap` workspace and the host stays out of reach. On Kubernetes, each run is its own pod and the kubelet holds the CPU and memory limits. One runtime contract covers both, and warren picks the backend once at boot.
