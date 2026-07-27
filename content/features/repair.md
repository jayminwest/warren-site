---
order: 5
eyebrow: "Repair"
title: "Warren fixes its own pull requests"
---

When the checks on an agent-authored pull request fail, warren dispatches a repair run against that same branch. A retry cap and a cooldown per pull request hold the loop in check. A monitoring alert can post to `/alerts/heal`, and warren opens a fresh branch with the fix. Both loops stay quiet until you turn them on per project.
