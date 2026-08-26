// 独立部署文档站点到 GitHub Pages
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import ghpages from "gh-pages";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

export async function deployDocs() {
  const docsDir = path.join(rootDir, "packages", "docs");

  console.log("\n🔨 Building site...");
  execSync("pnpm run build", { stdio: "inherit", cwd: docsDir });

  const siteDist = path.join(docsDir, "site-dist");
  if (!fs.existsSync(siteDist)) {
    throw new Error(`site-dist not found at ${siteDist}`);
  }

  console.log("📤 Deploying to GitHub Pages...");
  await new Promise((resolve, reject) => {
    ghpages.publish(
      siteDist,
      {
        message: `deploy: docs`,
      },
      (err) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });

  console.log("✅ Site deployed to GitHub Pages!\n");
}

// 支持直接运行
const isDirectRun = process.argv[1] && fileURLToPath(`file://${process.argv[1]}`) === __filename;
if (isDirectRun) {
  deployDocs().catch((err) => {
    console.error("❌ Failed to deploy docs:", err);
    process.exit(1);
  });
}
