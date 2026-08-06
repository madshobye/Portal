import { createStartupStatusUi } from "./libraries/ui-engine/index.js";

/* The source-coherence gate runs before the application module graph is
   allowed to start. This small UI-node bootstrap gives that gate a visible,
   retained status surface without putting HTML or DOM authority in index. */
export function createVj1StartupUi() {
  return createStartupStatusUi({
    inputs: {
      state: "loading",
      title: "VJ1",
      message: "Checking application sources…",
    },
  });
}
