# VJ1 Metrics Suite

This suite analyzes `project.json` structure and runtime metric samples to identify likely composition, render, and mapping bottlenecks.

## Node

From `experiments/vj1`:

```sh
npm run test:metrics
npm run metrics -- /path/to/project.json
npm run metrics -- /path/to/project.json --json
npm run metrics -- /path/to/project.json --runtime metrics-results/runs/RUN.samples.json
npm run metrics -- /path/to/project.json --save
npm run metrics -- /path/to/project.json --compare metrics-results/runs/OLD.metrics.json
```

The CLI prints a Markdown report by default and JSON with `--json`.
Use `--save` to write timestamped JSON and Markdown reports into `metrics-results/runs/`.
Use `--out <prefix>` to choose a deterministic filename prefix.
Use `--runtime <samples.json>` to include browser-captured renderer samples in the same report.

## Browser

Open `experiments/vj1/metrics.html` in the same local server/origin as VJ1.

- Choose a `project.json` file to run static analysis.
- Click `Listen 10s Runtime` while a VJ1 control/preview/output page is open on the same origin to collect BroadcastChannel metric samples.
- Download the JSON report and hand it back to Codex for deeper diagnosis.
- In the main VJ1 UI, click the top-bar render-cost percentage for a bounded current hotspot overview. Choose **Analyze 10 seconds** for renderer attribution plus UI rebuilds, main-thread long tasks, event-loop lag, state activity, transport, and optional heap data. The result modal can download a `.profile.json` report and stores the same report on `window.__vj1LastProfileReport`.

For repeatable output-runtime sampling, open the output app directly with a fixture:

```text
https://127.0.0.1:8082/experiments/vj1/?output=1&fixture=tests/fixtures/four-surface-show.json
```

The output app stores its latest 240 renderer samples on `window.__vj1RuntimeMetrics`.
Those samples include pass-level shader profile data when the renderer is running WebGL effects.
The same samples are mirrored into `#vj1-runtime-metrics` as inert JSON so browser automation can read them consistently.

Store important downloaded reports in `metrics-results/runs/` using the same naming convention as the Node runner:

```text
YYYY-MM-DDTHH-mm-ss-sssZ-project-name.metrics.json
YYYY-MM-DDTHH-mm-ss-sssZ-project-name.metrics.md
```

## What It Measures

- Composition chain size, source/effect counts, branches, custom shaders, missing media, thumbnail bloat.
- Surface assignments, active surface count, render/world/surface texture sizes.
- Mapping coverage, degenerate corners, off-world corners.
- Runtime FPS, frame time, and render-cost samples when available.
- Runtime shader passes, batched shader chains, ping-pong handoffs, and slow pass samples when available.

## Consistent Workflow

1. Run the app state you care about, then save a metrics report with `--save` or from `metrics.html`.
2. Keep the previous meaningful report in `metrics-results/runs/`.
3. Compare with `--compare` before and after renderer or composition changes.
4. Treat static bottlenecks as leads, not proof; runtime samples are needed for final performance calls.
