---
order: 3
eyebrow: "Autonomy"
glyph: "loop"
title: "Runs that start and fix themselves"
---

Cron triggers dispatch runs on a schedule, on the same path a manual run takes. When the checks on an agent-authored pull request fail, warren dispatches a repair run against that same branch. A retry cap and a cooldown hold that loop in check, and both loops stay off until you turn them on per project.
