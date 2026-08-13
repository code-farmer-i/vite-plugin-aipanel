import fs from "fs";
import path from "path";
import { resolvePackageDir } from "@vite-plugin-opencode-assistant/shared/node";

const packageDir = resolvePackageDir("vite-plugin-opencode-assistant");

export function resolveWidgetPath(): string {
  const candidatePaths = [
    path.join(packageDir, "es", "client.js"),
    path.join(packageDir, "lib", "client.js"),
  ];

  for (const candidatePath of candidatePaths) {
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return candidatePaths[0];
}

export function resolveWidgetStylePath(): string {
  const candidatePaths = [
    path.join(packageDir, "es", "client.css"),
    path.join(packageDir, "lib", "client.css"),
  ];

  for (const candidatePath of candidatePaths) {
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return candidatePaths[0];
}

export function resolveVueDevtoolsBridgePath(): string {
  const candidatePaths = [
    path.join(packageDir, "es", "client", "vue-devtools-bridge.mjs"),
    path.join(packageDir, "lib", "client", "vue-devtools-bridge.cjs"),
  ];

  for (const candidatePath of candidatePaths) {
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return candidatePaths[0];
}
