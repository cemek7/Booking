# Techclave Gate pilot reports

This directory retains only redacted Gate decisions and reviewer outcomes for the Booka internal pilot. Never commit raw diffs, `.env` content, credentials, or model prompts here.

Replay a historical change without checking out or running its head revision:

```bash
node scripts/techclave-gate/replay.cjs --base <base-sha> --head <head-sha> --output-root docs/reports/techclave-gate/replays
```

The pilot continues after 30 Booka pull requests only when at least 70% of surfaced findings are accepted, fixed, or acknowledged as real risk; false positives are below one per PR; no included deterministic critical check is missed; and latency/cost fit review flow.
