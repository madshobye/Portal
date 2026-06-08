export function createStartupStepRunner({
  logLine = () => {},
} = {}) {
  async function run(label, fn) {
    try {
      await fn();
    } catch (error) {
      logLine("warn", `${label} failed: ${error?.message || error}`);
    }
  }

  return { run };
}
