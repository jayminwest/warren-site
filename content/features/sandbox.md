---
order: 2
eyebrow: "Sandbox"
glyph: "shield"
title: "Every run is sandboxed"
---

Each run gets a fresh sandbox: `bwrap` on one box, a container under Docker, a pod on Kubernetes. A runaway run kills its sandbox, not the control plane.
