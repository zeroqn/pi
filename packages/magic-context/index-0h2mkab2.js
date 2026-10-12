// ../plugin/src/shared/harness.ts
var currentHarness = "opencode";
var harnessLocked = false;
function setHarness2(value) {
  if (harnessLocked && currentHarness !== value) {
    throw new Error(`Magic Context: harness already locked to "${currentHarness}"; cannot change to "${value}"`);
  }
  currentHarness = value;
  harnessLocked = true;
}
function getHarness2() {
  return currentHarness;
}
function harnessOwnsOpenCodeStore2(harness = currentHarness) {
  return harness === "opencode" || harness === "opencode2";
}
export { setHarness2, getHarness2, harnessOwnsOpenCodeStore2 };
