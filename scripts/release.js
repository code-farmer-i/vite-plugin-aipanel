import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import enquirer from "enquirer";
import semver from "semver";
import ghpages from "gh-pages";

const { prompt } = enquirer;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// 1. Read root package.json to get the current version
const rootPackageJsonPath = path.join(rootDir, "package.json");
const rootPackageJson = JSON.parse(fs.readFileSync(rootPackageJsonPath, "utf-8"));
const currentVersion = rootPackageJson.version;

console.log(`\n🚀 Current version is v${currentVersion}\n`);

const preReleaseMatches = currentVersion.match(/-(alpha|beta|rc)\.\d+$/);
const preReleaseId = preReleaseMatches ? preReleaseMatches[1] : undefined;

const versionIncrements = [
  "patch",
  "minor",
  "major",
  ...(preReleaseId ? ["prepatch", "preminor", "premajor", "prerelease"] : []),
];

const inc = (i) => semver.inc(currentVersion, i, preReleaseId);

async function checkNpmLogin() {
  try {
    const user = execSync("npm whoami --registry=https://registry.npmjs.org/ --silent", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    console.log(`✅ Logged in to npm as: ${user}`);
    return true;
  } catch {
    console.log("⚠️  Not logged in to npm. Starting login process...\n");
    try {
      execSync("npm login --registry=https://registry.npmjs.org/", {
        stdio: "inherit",
      });
      console.log("\n✅ Login successful!\n");
      return true;
    } catch (loginErr) {
      console.error("❌ Login failed:", loginErr.message);
      return false;
    }
  }
}

async function main() {
  console.log("\n🔍 Checking npm login status...");
  if (!(await checkNpmLogin())) {
    process.exit(1);
  }

  const { release } = await prompt({
    type: "select",
    name: "release",
    message: "Select release type",
    choices: versionIncrements.map((i) => `${i} (${inc(i)})`).concat(["custom"]),
  });

  let targetVersion;

  if (release === "custom") {
    const { version } = await prompt({
      type: "input",
      name: "version",
      message: "Input custom version",
      initial: currentVersion,
    });
    targetVersion = version;
  } else {
    targetVersion = release.match(/\((.*)\)/)[1];
  }

  if (!semver.valid(targetVersion)) {
    throw new Error(`invalid target version: ${targetVersion}`);
  }

  const { yes } = await prompt({
    type: "confirm",
    name: "yes",
    message: `Releasing v${targetVersion}. Confirm?`,
  });

  if (!yes) {
    console.log("Cancelled.");
    return;
  }

  console.log(`\n🚀 Starting release process for version v${targetVersion}...\n`);

  // Define rollback function
  const rollbackVersion = (version) => {
    console.log(`\n⏪ Rolling back versions to v${version}...`);

    // Rollback root package.json
    const rootPkg = JSON.parse(fs.readFileSync(rootPackageJsonPath, "utf-8"));
    rootPkg.version = version;
    fs.writeFileSync(rootPackageJsonPath, JSON.stringify(rootPkg, null, 2) + "\n");
    console.log(`   ✅ Rolled back root package.json to v${version}`);

    // Rollback all packages
    const packagesDir = path.join(rootDir, "packages");
    if (fs.existsSync(packagesDir)) {
      const packages = fs.readdirSync(packagesDir).filter((pkg) => {
        return fs.statSync(path.join(packagesDir, pkg)).isDirectory();
      });

      packages.forEach((pkg) => {
        const pkgDir = path.join(packagesDir, pkg);
        const pkgJsonPath = path.join(pkgDir, "package.json");
        if (fs.existsSync(pkgJsonPath)) {
          const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
          if (pkgJson.version !== version) {
            pkgJson.version = version;
            fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n");
            console.log(`   ✅ Rolled back ${pkgJson.name} to v${version}`);
          }
        }
      });
    }
    // Rollback manifest.json
    const manifestPath = path.join(packagesDir, "extension", "src", "manifest.json");
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      if (manifest.version !== version) {
        manifest.version = version;
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
        console.log(`   ✅ Rolled back manifest.json to v${version}`);
      }
    }
    console.log(`⏪ Rollback completed!\n`);
  };

  // Register process exit handlers for unexpected termination
  let isCompleted = false;
  const handleExit = () => {
    if (!isCompleted) {
      console.log("\n⚠️ Process interrupted! Initiating rollback...");
      rollbackVersion(currentVersion);
    }
    process.exit(1);
  };

  process.on("SIGINT", handleExit);
  process.on("SIGTERM", handleExit);
  process.on("uncaughtException", (err) => {
    console.error("\n❌ Uncaught Exception:", err);
    handleExit();
  });

  // Update root package.json
  rootPackageJson.version = targetVersion;
  fs.writeFileSync(rootPackageJsonPath, JSON.stringify(rootPackageJson, null, 2) + "\n");
  console.log(`✅ Updated root package.json to v${targetVersion}`);

  // 2. Find all packages under packages/
  const packagesDir = path.join(rootDir, "packages");
  if (!fs.existsSync(packagesDir)) {
    console.error("❌ packages directory not found!");
    process.exit(1);
  }

  const packages = fs.readdirSync(packagesDir).filter((pkg) => {
    return fs.statSync(path.join(packagesDir, pkg)).isDirectory();
  });

  // 3. Sync version to all packages
  console.log("\n📦 Syncing versions to packages...");

  packages.forEach((pkg) => {
    const pkgDir = path.join(packagesDir, pkg);
    const pkgJsonPath = path.join(pkgDir, "package.json");

    if (fs.existsSync(pkgJsonPath)) {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));

      // 同步所有包版本（包括私有包），发布时 private 包会自动跳过
      if (pkgJson.version !== targetVersion) {
        pkgJson.version = targetVersion;
        fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n");
        console.log(`   ✅ Updated ${pkgJson.name} to v${targetVersion}`);
      } else {
        console.log(`   ℹ️  ${pkgJson.name} is already at v${targetVersion}`);
      }
    }
  });

  // 同步 Chrome 扩展 manifest.json 版本
  const manifestPath = path.join(packagesDir, "extension", "src", "manifest.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    if (manifest.version !== targetVersion) {
      manifest.version = targetVersion;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
      console.log(`   ✅ Updated manifest.json to v${targetVersion}`);
    }
  }

  // 4. Build packages
  console.log("\n🔨 Building all packages...");
  try {
    execSync("pnpm run build", { stdio: "inherit", cwd: rootDir });
    console.log("   ✅ Build successful!");
  } catch (e) {
    console.error("❌ Build failed!", e.message);
    rollbackVersion(currentVersion);
    isCompleted = true; // Prevent double rollback in exit handler
    process.exit(1);
  }

  // 5. Package VS Code extension
  console.log("\n📦 Packaging VS Code extension...");
  const vsixDir = path.join(packagesDir, "vscode-extension");
  // 清理旧版本 .vsix
  const oldVsixFiles = fs.readdirSync(vsixDir).filter((f) => f.endsWith(".vsix"));
  oldVsixFiles.forEach((f) => {
    fs.unlinkSync(path.join(vsixDir, f));
    console.log(`   🗑️  Removed old ${f}`);
  });
  execSync("pnpm run package", { stdio: "inherit", cwd: vsixDir });

  // 6. Build and deploy site to GitHub Pages
  console.log("\n🌐 Building and deploying site to GitHub Pages...");
  try {
    const viteDir = path.join(packagesDir, "vite");
    execSync("pnpm run build:site", { stdio: "inherit", cwd: viteDir });

    const siteDist = path.join(viteDir, "site-dist");
    if (!fs.existsSync(siteDist)) {
      throw new Error(`site-dist not found at ${siteDist}`);
    }

    await new Promise((resolve, reject) => {
      ghpages.publish(
        siteDist,
        {
          message: `deploy: v${targetVersion}`,
        },
        (err) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });

    console.log("   ✅ Site deployed to GitHub Pages!");
  } catch (err) {
    console.error("\n❌ Failed to deploy site:", err instanceof Error ? err.message : String(err));
    rollbackVersion(currentVersion);
    isCompleted = true; // Prevent double rollback in exit handler
    process.exit(1);
  }

  // 7. Publish packages
  console.log("\n📤 Publishing packages...");
  try {
    execSync(
      "pnpm -r publish --access public --no-git-checks --registry=https://registry.npmjs.org/",
      {
        stdio: "inherit",
        cwd: rootDir,
      },
    );
    isCompleted = true; // Mark as successfully completed
    console.log(`\n🎉 Release process for v${targetVersion} completed!\n`);
  } catch (err) {
    console.error(
      "\n❌ Failed to publish packages:",
      err instanceof Error ? err.message : String(err),
    );
    rollbackVersion(currentVersion);
    isCompleted = true; // Prevent double rollback in exit handler
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Release script error:", err);
  process.exit(1);
});
