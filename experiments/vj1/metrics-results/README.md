# VJ1 Metrics Results

Use this folder for comparable metrics output over time.

## Layout

- `runs/` contains timestamped reports from real projects or browser sampling sessions.
- `baselines/` contains stable reference reports that are useful for regression checks.

## Naming

Use the runner's default `--save` naming unless there is a reason to override it:

```sh
npm run metrics -- /path/to/project.json --save
```

That creates:

```text
metrics-results/runs/YYYY-MM-DDTHH-mm-ss-sssZ-project-name.metrics.json
metrics-results/runs/YYYY-MM-DDTHH-mm-ss-sssZ-project-name.metrics.md
```

If a run is tied to a known issue or test case, use a descriptive `--out` prefix:

```sh
npm run metrics -- /path/to/project.json --out metrics-results/runs/2026-07-10-large-video-wall
```

## Comparing Runs

Compare a current project against an old JSON report:

```sh
npm run metrics -- /path/to/project.json --compare metrics-results/runs/OLD.metrics.json
```

When reporting a performance problem back to Codex, include:

- The current `*.metrics.json`.
- The previous/baseline `*.metrics.json` used for comparison.
- A short note about what was open in the browser if runtime samples were collected.

## Retention

Keep baselines small and stable. For `runs/`, keep representative logs for meaningful project states and delete noisy duplicates after diagnosis.
