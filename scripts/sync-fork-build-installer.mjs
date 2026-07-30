import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const upstreamUrl = "https://github.com/getpaseo/paseo.git";
const mainBranch = "main";
const integrationBranch = "integration/custom-vnext";
const featureBranches = ["feature/latex-support", "feature/open-file-with-default-app"];

function usageAndExit(code = 0) {
  process.stderr.write(
    "Usage: node scripts/sync-fork-build-installer.mjs [--proxy <url>] [--sync-only | --build-only] [--no-push]\n",
  );
  process.exit(code);
}

function parseArgs(argv) {
  const options = {
    proxy: "http://127.0.0.1:7890",
    syncOnly: false,
    buildOnly: false,
    push: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--proxy") {
      options.proxy = argv[index + 1] ?? "";
      index += 1;
      if (!options.proxy) usageAndExit(1);
      continue;
    }
    if (arg === "--sync-only") {
      options.syncOnly = true;
      continue;
    }
    if (arg === "--build-only") {
      options.buildOnly = true;
      continue;
    }
    if (arg === "--no-push") {
      options.push = false;
      continue;
    }
    if (arg === "--help" || arg === "-h") usageAndExit(0);
    usageAndExit(1);
  }

  if (options.syncOnly && options.buildOnly) {
    throw new Error("--sync-only and --build-only cannot be used together.");
  }
  return options;
}

function run(command, args, { env = process.env } = {}) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  execFileSync(command, args, { cwd: rootDir, env, stdio: "inherit" });
}

function runQuiet(command, args) {
  return execFileSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryQuiet(command, args) {
  try {
    return runQuiet(command, args);
  } catch {
    return "";
  }
}

function gitRefExists(ref) {
  return spawnSync("git", ["show-ref", "--verify", "--quiet", ref], { cwd: rootDir }).status === 0;
}

function gitIsAncestor(ancestor, descendant) {
  return (
    spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: rootDir,
    }).status === 0
  );
}

function assertClean() {
  const status = runQuiet("git", ["status", "--porcelain"]);
  if (status) throw new Error("Working tree must be clean before this workflow runs.");
}

function ensureUpstreamRemote() {
  const configuredUrl = tryQuiet("git", ["remote", "get-url", "upstream"]);
  if (!configuredUrl) {
    run("git", ["remote", "add", "upstream", upstreamUrl]);
    return;
  }
  if (configuredUrl !== upstreamUrl) {
    throw new Error(`Remote upstream points to ${configuredUrl}; expected ${upstreamUrl}.`);
  }
}

function changedFiles(range) {
  const output = runQuiet("git", ["diff", "--name-only", range]);
  return new Set(output ? output.split(/\r?\n/u) : []);
}

function printOverlap(featureBranch, featureBase) {
  const officialBase = runQuiet("git", ["merge-base", "upstream/main", featureBranch]);
  const officialFiles = changedFiles(`${officialBase}..upstream/main`);
  const featureFiles = changedFiles(`${featureBase}..${featureBranch}`);
  const overlap = [...featureFiles].filter((file) => officialFiles.has(file)).sort();

  console.log(`\nOverlap for ${featureBranch}: ${overlap.length} file(s)`);
  for (const file of overlap) console.log(`  ${file}`);
}

function assertMergePreflight(featureBranch) {
  const result = spawnSync("git", ["merge-tree", "--write-tree", "upstream/main", featureBranch], {
    cwd: rootDir,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`Merge preflight failed for ${featureBranch}.`);
  }
  console.log(`Merge preflight clean: upstream/main + ${featureBranch}`);
}

function switchIntegrationBranch() {
  if (gitRefExists(`refs/heads/${integrationBranch}`)) {
    run("git", ["switch", integrationBranch]);
    return;
  }
  if (gitRefExists(`refs/remotes/origin/${integrationBranch}`)) {
    run("git", ["switch", "--track", "-c", integrationBranch, `origin/${integrationBranch}`]);
    return;
  }
  run("git", ["switch", "-c", integrationBranch, mainBranch]);
}

function syncAndMerge({ push }) {
  ensureUpstreamRemote();
  run("git", ["fetch", "--prune", "origin"]);
  run("git", ["fetch", "--prune", "upstream"]);

  for (const branch of featureBranches) {
    if (!gitRefExists(`refs/heads/${branch}`)) throw new Error(`Missing local branch: ${branch}`);
  }
  if (!gitIsAncestor("origin/main", "upstream/main")) {
    throw new Error(
      "origin/main has commits not present in upstream/main; refusing to rewrite fork main.",
    );
  }

  const firstBase = runQuiet("git", ["merge-base", "upstream/main", featureBranches[0]]);
  printOverlap(featureBranches[0], firstBase);
  printOverlap(featureBranches[1], featureBranches[0]);
  for (const branch of featureBranches) assertMergePreflight(branch);

  run("git", ["switch", mainBranch]);
  run("git", ["merge", "--ff-only", "upstream/main"]);
  if (push) run("git", ["push", "origin", mainBranch]);

  switchIntegrationBranch();
  run("git", [
    "merge",
    "--no-ff",
    mainBranch,
    "-m",
    `Merge official ${mainBranch} into ${integrationBranch}`,
  ]);
  for (const branch of featureBranches) {
    run("git", ["merge", "--no-ff", branch, "-m", `Merge ${branch} into ${integrationBranch}`]);
  }
  if (push) run("git", ["push", "-u", "origin", integrationBranch]);
  assertClean();
}

function proxyEnvironment(proxy) {
  return {
    ...process.env,
    ALL_PROXY: proxy,
    ELECTRON_GET_USE_PROXY: "1",
    GLOBAL_AGENT_HTTP_PROXY: proxy,
    GLOBAL_AGENT_HTTPS_PROXY: proxy,
    HTTP_PROXY: proxy,
    HTTPS_PROXY: proxy,
    NO_PROXY: "localhost,127.0.0.1",
    npm_config_https_proxy: proxy,
    npm_config_proxy: proxy,
  };
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function buildInstaller(proxy) {
  if (process.platform !== "win32") throw new Error("Windows installer builds require Windows.");
  const currentBranch = runQuiet("git", ["branch", "--show-current"]);
  if (currentBranch !== integrationBranch) {
    throw new Error(
      `Installer must be built from ${integrationBranch}; current branch is ${currentBranch}.`,
    );
  }

  const env = proxyEnvironment(proxy);
  run("npm", ["ci", "--foreground-scripts"], { env });
  run(
    "npm",
    [
      "run",
      "build:desktop",
      "--",
      "--win",
      "nsis",
      "--x64",
      "--publish",
      "never",
      "--config.win.signAndEditExecutable=false",
    ],
    { env },
  );

  const rootPackage = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
  const installer = path.join(
    rootDir,
    "packages",
    "desktop",
    "release",
    `Paseo-Setup-${rootPackage.version}-x64.exe`,
  );
  if (!existsSync(installer)) throw new Error(`Installer was not produced: ${installer}`);

  const sevenZip = path.join(rootDir, "node_modules", "7zip-bin", "win", "x64", "7za.exe");
  run(sevenZip, ["t", installer]);
  const size = statSync(installer).size;
  const checksum = await sha256(installer);
  assertClean();

  console.log("\nInstaller complete");
  console.log(`Path: ${installer}`);
  console.log(`Size: ${size} bytes`);
  console.log(`SHA-256: ${checksum}`);
}

const options = parseArgs(process.argv.slice(2));
assertClean();
if (!options.buildOnly) syncAndMerge(options);
if (!options.syncOnly) await buildInstaller(options.proxy);
