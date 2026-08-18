---
order: 2
eyebrow: "Sandbox"
glyph: "shield"
title: "Every run is sandboxed"
---

Each run gets a fresh sandbox, and the host stays out of reach. On one box that sandbox is a `bwrap` workspace. Under Docker it is a sibling container. On Kubernetes it is a pod with its own CPU and memory limits.
