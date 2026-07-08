import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(path.join(process.cwd(), "package.json"));
const packageDir = resolvePackageDir();

export function resolvePackageDir(): string {
  const entryPath = require.resolve("vite-plugin-opencode-assistant");
  return path.resolve(path.dirname(entryPath), "..");
}

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
