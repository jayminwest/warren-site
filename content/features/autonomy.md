---
order: 3
eyebrow: "Autonomy"
glyph: "loop"
title: "Runs that start and fix themselves"
---

A `.warren/triggers.yaml` file defines cron triggers per project, and the scheduler dispatches them on the same path a manual run takes. When the checks on an agent-authored pull request fail, warren dispatches a repair run against that same branch. A retry cap and a cooldown hold that loop in check. Both loops stay quiet until you turn them on per project.
