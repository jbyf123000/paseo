import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { load as parseYaml } from "js-yaml";

const workflowPath = new URL("../.github/workflows/desktop-release.yml", import.meta.url);
const workflow = parseYaml(readFileSync(workflowPath, "utf8"));

function getMacStep(name) {
  const steps = workflow.jobs["publish-macos"].steps;
  const step = steps.find((candidate) => candidate.name === name);
  assert.ok(step, `missing macOS step: ${name}`);
  return step;
}

test("manual fork macOS releases create a release and verify the arm64 DMG", () => {
  const createReleaseCondition = workflow.jobs["create-release"].if;
  assert.match(createReleaseCondition, /github\.event_name == 'push'/);
  assert.match(createReleaseCondition, /github\.event_name == 'workflow_dispatch'/);
  assert.match(createReleaseCondition, /github\.event\.inputs\.publish != 'false'/);

  const macMatrix = workflow.jobs["publish-macos"].strategy.matrix.include;
  assert.deepEqual(
    macMatrix.find((entry) => entry.electron_arch === "arm64"),
    { runner: "macos-14", electron_arch: "arm64" },
  );

  const buildStep = getMacStep("Build desktop release");
  assert.match(buildStep.run, /unset CSC_LINK CSC_KEY_PASSWORD/);
  assert.match(buildStep.run, /No Apple certificate configured/);

  const verifyStep = getMacStep("Verify Apple Silicon DMG");
  assert.equal(verifyStep.if, "matrix.electron_arch == 'arm64'");
  assert.match(verifyStep.run, /-arm64\.dmg/);

  const uploadStep = getMacStep("Upload desktop artifacts to release");
  assert.match(uploadStep.run, /gh release upload[\s\S]*github\.repository/);
});
