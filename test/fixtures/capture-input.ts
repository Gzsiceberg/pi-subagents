import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Real TUI input, but no provider requests or tool execution. */
export default function captureInput(pi: ExtensionAPI) {
  pi.registerFlag("capture-input", { type: "string", description: "Smoke test output path" });
  pi.on("before_provider_request", () => {
    throw new Error("Smoke tests must never make provider requests");
  });
  pi.on("input", (event) => {
    const path = pi.getFlag("capture-input");
    if (typeof path !== "string") throw new Error("Missing --capture-input");
    appendFileSync(path, JSON.stringify(event.text) + "\n");
    return { action: "handled" };
  });
}
