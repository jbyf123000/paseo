import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const upstreamUrl = "https://github.com/getpaseo/paseo.git";
const forkMainBranch = "main";
const defaultIntegrationBranch = "integration/custom-v030";
const workflowDir = path.join(rootDir, ".dev", "custom-installer");

function usageAndExit(code = 0) {
  const stream = code === 0 ? process.stdout : process.stderr;
  stream.write(
    `Usage: npm run custom:sync-build-installer -- [options]\n\nOptions:\n  --integration-branch <branch>  Integration branch to update (default: ${defaultIntegrationBranch})\n  --custom-branch <ref>          Merge an additional custom branch or ref; repeatable\n  --proxy <url>                  HTTP proxy for dependency and Electron downloads\n  --no-proxy                     Do not add proxy environment variables\n  --sync-only                    Update the fork and integration branch without building\n  --build-only                   Build the current integration branch without Git updates\n  --no-push                      Keep Git updates local\n  --force-build                  Rebuild even when this commit already has an installer\n  --dry-run                      Print the planned workflow without changing files\n  --help, -h                     Show this help\n`,
  );
  process.exit(code);
}

function requireValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    customBranches: [],
    dryRun: false,
    forceBuild: false,
    integrationBranch: defaultIntegrationBranch,
    buildOnly: false,
    noProxy: false,
    proxy: "http://127.0.0.1:7890",
    push: true,
    syncOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--integration-branch") {
      options.integrationBranch = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--custom-branch") {
      options.customBranches.push(requireValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--proxy") {
      options.proxy = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--no-proxy") {
      options.noProxy = true;
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
    if (arg === "--force-build") {
      options.forceBuild = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") usageAndExit(0);
    throw new Error(`Unknown option: ${arg}`);
  }

  if (options.syncOnly && options.buildOnly) {
    throw new Error("--sync-only and --build-only cannot be used together.");
  }
  if (options.noProxy && argv.includes("--proxy")) {
    throw new Error("--proxy and --no-proxy cannot be used together.");
  }

  return options;
}

function resolveInvocation(command, args) {
  if (command !== "npm") return { executable: command, args };

  const npmCli =
    process.env.npm_execpath ??
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (!existsSync(npmCli)) {
    throw new Error("Cannot locate npm CLI. Run this workflow through its npm script.");
  }

  return { executable: process.execPath, args: [npmCli, ...args] };
}

function run(command, args, { env = process.env } = {}) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const invocation = resolveInvocation(command, args);
  execFileSync(invocation.executable, invocation.args, { cwd: rootDir, env, stdio: "inherit" });
}

function runLogged(command, args, logFile, { env = process.env } = {}) {
  mkdirSync(path.dirname(logFile), { recursive: true });
  console.log(`\n> ${command} ${args.join(" ")}\n  log: ${logFile}`);

  const invocation = resolveInvocation(command, args);
  const logDescriptor = openSync(logFile, "w");
  let result;
  try {
    result = spawnSync(invocation.executable, invocation.args, {
      cwd: rootDir,
      env,
      stdio: ["ignore", logDescriptor, logDescriptor],
    });
  } finally {
    closeSync(logDescriptor);
  }

  if (result?.error || result?.status !== 0) {
    const tail = readFileSync(logFile, "utf8").split(/\r?\n/u).slice(-80).join("\n");
    process.stderr.write(`${tail}\n`);
    throw result?.error ?? new Error(`${command} exited with status ${result?.status}.`);
  }

  console.log("  completed");
}

function runQuiet(command, args) {
  const invocation = resolveInvocation(command, args);
  return execFileSync(invocation.executable, invocation.args, {
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
  return (
    spawnSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
      cwd: rootDir,
      stdio: "ignore",
    }).status === 0
  );
}

function gitIsAncestor(ancestor, descendant) {
  return (
    spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: rootDir,
      stdio: "ignore",
    }).status === 0
  );
}

function assertClean() {
  const status = runQuiet("git", ["status", "--porcelain"]);
  if (status) throw new Error("Working tree must be clean before this workflow runs.");
}

function assertLocalBranchName(branch) {
  const result = spawnSync("git", ["check-ref-format", "--branch", branch], {
    cwd: rootDir,
    stdio: "ignore",
  });
  if (result.status !== 0) {
    throw new Error(`Invalid local branch name: ${branch}`);
  }
}

function ensureUpstreamRemote() {
  const configuredUrl = tryQuiet("git", ["remote", "get-url", "upstream"]);
  if (!configuredUrl) {
    run("git", ["remote", "add", "upstream", upstreamUrl]);
    return;
  }

  const acceptedUrls = new Set([
    upstreamUrl,
    "git@github.com:getpaseo/paseo.git",
    "ssh://git@github.com/getpaseo/paseo.git",
  ]);
  if (!acceptedUrls.has(configuredUrl)) {
    throw new Error(
      `Remote upstream points to ${configuredUrl}; expected the official getpaseo/paseo repository.`,
    );
  }
}

function assertMergePreflight(ours, theirs) {
  if (ours === theirs || gitIsAncestor(theirs, ours)) return;

  const result = spawnSync("git", ["merge-tree", "--write-tree", ours, theirs], {
    cwd: rootDir,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`Merge preflight failed: ${theirs} cannot be merged cleanly into ${ours}.`);
  }
  console.log(`Merge preflight clean: ${ours} + ${theirs}`);
}

function ensureForkMainBranch() {
  if (gitRefExists(forkMainBranch)) return;
  if (!gitRefExists(`origin/${forkMainBranch}`)) {
    throw new Error(`Missing local and origin/${forkMainBranch} branches.`);
  }
  run("git", ["switch", "--track", "-c", forkMainBranch, `origin/${forkMainBranch}`]);
}

function integrationBaseRef(integrationBranch) {
  if (gitRefExists(integrationBranch)) return integrationBranch;
  if (gitRefExists(`origin/${integrationBranch}`)) return `origin/${integrationBranch}`;
  return "upstream/main";
}

function switchIntegrationBranch(integrationBranch) {
  if (gitRefExists(integrationBranch)) {
    run("git", ["switch", integrationBranch]);
    return;
  }
  if (gitRefExists(`origin/${integrationBranch}`)) {
    run("git", ["switch", "--track", "-c", integrationBranch, `origin/${integrationBranch}`]);
    return;
  }
  run("git", ["switch", "-c", integrationBranch, forkMainBranch]);
}

function syncForkAndIntegration(options) {
  assertLocalBranchName(options.integrationBranch);
  ensureUpstreamRemote();
  run("git", ["fetch", "--prune", "origin"]);
  run("git", ["fetch", "--prune", "--tags", "upstream"]);

  if (!gitRefExists(`origin/${forkMainBranch}`)) {
    throw new Error(`Missing origin/${forkMainBranch} after fetch.`);
  }
  if (!gitIsAncestor(`origin/${forkMainBranch}`, "upstream/main")) {
    throw new Error(
      `origin/${forkMainBranch} has commits not present in upstream/main; refusing to overwrite the fork main branch.`,
    );
  }

  const baseRef = integrationBaseRef(options.integrationBranch);
  assertMergePreflight(baseRef, "upstream/main");
  for (const customBranch of options.customBranches) {
    if (!gitRefExists(customBranch)) {
      throw new Error(`Custom branch or ref does not exist: ${customBranch}`);
    }
    assertMergePreflight(baseRef, customBranch);
  }

  ensureForkMainBranch();
  if (!gitIsAncestor(forkMainBranch, "upstream/main")) {
    throw new Error(
      `Local ${forkMainBranch} has commits not present in upstream/main; resolve it before running this workflow.`,
    );
  }
  run("git", ["switch", forkMainBranch]);
  run("git", ["merge", "--ff-only", "upstream/main"]);
  if (options.push) run("git", ["push", "origin", forkMainBranch]);

  switchIntegrationBranch(options.integrationBranch);
  run("git", [
    "merge",
    "--no-ff",
    forkMainBranch,
    "-m",
    `Merge official ${forkMainBranch} into ${options.integrationBranch}`,
  ]);
  for (const customBranch of options.customBranches) {
    run("git", [
      "merge",
      "--no-ff",
      customBranch,
      "-m",
      `Merge ${customBranch} into ${options.integrationBranch}`,
    ]);
  }
  if (options.push) run("git", ["push", "-u", "origin", options.integrationBranch]);
  assertClean();
}

function proxyEnvironment(options) {
  if (options.noProxy) return process.env;

  return {
    ...process.env,
    ALL_PROXY: options.proxy,
    ELECTRON_GET_USE_PROXY: "1",
    GLOBAL_AGENT_HTTP_PROXY: options.proxy,
    GLOBAL_AGENT_HTTPS_PROXY: options.proxy,
    HTTP_PROXY: options.proxy,
    HTTPS_PROXY: options.proxy,
    NO_PROXY: "localhost,127.0.0.1",
    npm_config_https_proxy: options.proxy,
    npm_config_proxy: options.proxy,
  };
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function dependencyFilesExist() {
  return [
    path.join(rootDir, "node_modules", ".package-lock.json"),
    path.join(rootDir, "node_modules", "electron", "dist", "electron.exe"),
    path.join(rootDir, "node_modules", "7zip-bin", "win", "x64", "7za.exe"),
  ].every(existsSync);
}

function writeDependencyStamp(stampFile, lockSha256) {
  writeFileSync(
    stampFile,
    `${JSON.stringify({ lockSha256, node: process.version, platform: process.platform, arch: process.arch })}\n`,
  );
}

async function ensureDependencies(environment) {
  mkdirSync(workflowDir, { recursive: true });
  const lockFile = path.join(rootDir, "package-lock.json");
  const hiddenLockFile = path.join(rootDir, "node_modules", ".package-lock.json");
  const stampFile = path.join(workflowDir, "dependencies.json");
  const lockSha256 = await sha256(lockFile);

  if (dependencyFilesExist() && existsSync(stampFile)) {
    try {
      const stamp = JSON.parse(readFileSync(stampFile, "utf8"));
      if (
        stamp.lockSha256 === lockSha256 &&
        stamp.node === process.version &&
        stamp.platform === process.platform &&
        stamp.arch === process.arch
      ) {
        console.log("\nDependencies unchanged; skipping npm ci.");
        return;
      }
    } catch {
      // A malformed local stamp is a cache miss.
    }
  }

  if (dependencyFilesExist() && statSync(hiddenLockFile).mtimeMs >= statSync(lockFile).mtimeMs) {
    writeDependencyStamp(stampFile, lockSha256);
    console.log("\nExisting npm dependency tree is current; skipping npm ci.");
    return;
  }

  runLogged("npm", ["ci", "--foreground-scripts"], path.join(workflowDir, "npm-ci.log"), {
    env: environment,
  });
  writeDependencyStamp(stampFile, lockSha256);
}

async function buildInstaller(options) {
  if (process.platform !== "win32") throw new Error("Windows installer builds require Windows.");
  const currentBranch = runQuiet("git", ["branch", "--show-current"]);
  if (currentBranch !== options.integrationBranch) {
    throw new Error(
      `Installer must be built from ${options.integrationBranch}; current branch is ${currentBranch}.`,
    );
  }

  const commit = runQuiet("git", ["rev-parse", "--short=12", "HEAD"]);
  const outputKey = options.forceBuild ? `${commit}-${Date.now()}` : commit;
  const outputDir = path.join(rootDir, "packages", "desktop", "release", "custom", outputKey);
  const rootPackage = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
  const installer = path.join(outputDir, `Paseo-Setup-${rootPackage.version}-x64.exe`);
  let buildLog = "";

  if (existsSync(installer)) {
    console.log(`\nInstaller already exists for ${commit}; skipping build.`);
  } else {
    const environment = proxyEnvironment(options);
    await ensureDependencies(environment);
    buildLog = path.join(workflowDir, `build-${outputKey}.log`);
    runLogged(
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
        `--config.directories.output=${outputDir}`,
      ],
      buildLog,
      { env: environment },
    );
  }

  if (!existsSync(installer)) throw new Error(`Installer was not produced: ${installer}`);
  const sevenZip = path.join(rootDir, "node_modules", "7zip-bin", "win", "x64", "7za.exe");
  runLogged(sevenZip, ["t", installer], path.join(workflowDir, `archive-${outputKey}.log`));

  const size = statSync(installer).size;
  const checksum = await sha256(installer);
  assertClean();

  console.log("\nInstaller complete");
  console.log(`Path: ${installer}`);
  console.log(`Size: ${size} bytes`);
  console.log(`SHA-256: ${checksum}`);
  if (buildLog) console.log(`Build log: ${buildLog}`);
}

function printDryRun(options) {
  console.log("Dry run: no Git, dependency, or build changes will be made.");
  console.log(`Fork main: ${forkMainBranch} <- upstream/main`);
  console.log(`Integration branch: ${options.integrationBranch} <- ${forkMainBranch}`);
  for (const customBranch of options.customBranches) {
    console.log(`Additional custom branch: ${customBranch} -> ${options.integrationBranch}`);
  }
  if (!options.syncOnly) console.log("Installer: Windows x64 NSIS, local only, no publish");
}

const options = parseArgs(process.argv.slice(2));
if (options.dryRun) {
  printDryRun(options);
} else {
  assertClean();
  if (!options.buildOnly) syncForkAndIntegration(options);
  if (!options.syncOnly) await buildInstaller(options);
}
