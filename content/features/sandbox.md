---
order: 1
eyebrow: "Sandbox"
glyph: "shield"
title: "Every run is sandboxed"
---

Each run gets a fresh sandbox and the host stays out of reach. On a single host, that sandbox is a `bwrap` workspace. On Kubernetes, it is a pod with its own CPU and memory limits. Warren picks the backend once at boot.
