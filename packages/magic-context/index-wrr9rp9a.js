// ../plugin/src/shared/project-directory-key.ts
import path from "node:path";
function projectDirectoryKey(directory) {
  const slashed = directory.replaceAll("\\", "/").replace(/^\/\/\?\/UNC\//i, "//").replace(/^\/\/\?\//, "");
  if (/^[a-z]:\//i.test(slashed) || slashed.startsWith("//")) {
    return path.win32.normalize(slashed).replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
  }
  return path.resolve(directory);
}
function sameProjectDirectory(a, b) {
  if (a.length === 0 || b.length === 0)
    return false;
  return projectDirectoryKey(a) === projectDirectoryKey(b);
}

export { projectDirectoryKey, sameProjectDirectory };
