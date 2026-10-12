// ../plugin/src/shared/storage-permissions.ts
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  createWriteStream,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readlinkSync,
  readSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync
} from "node:fs";
import { open as openAsync, writeFile as writeFileAsync } from "node:fs/promises";
import { dirname, join } from "node:path";
var enforcePrivateStoragePermissions = true;
function setStoragePrivatePermissionEnforcement(enforce) {
  enforcePrivateStoragePermissions = enforce;
}
function shouldEnforcePrivateStoragePermissions() {
  return enforcePrivateStoragePermissions;
}
function ensureStorageDirectorySync(directory, forcePrivate = false, recursive = true) {
  const privateMode = forcePrivate || shouldEnforcePrivateStoragePermissions();
  mkdirSync(directory, {
    recursive,
    ...privateMode ? { mode: 448 } : {}
  });
}
function writeStorageFileSync(filePath, content, options = {}) {
  const { forcePrivate = false, ...writeOptions } = options;
  const privateMode = forcePrivate || shouldEnforcePrivateStoragePermissions();
  writeFileSync(filePath, content, {
    ...writeOptions,
    ...privateMode ? { mode: 384 } : {}
  });
}
function writeStorageFileAtomicSync(filePath, content, forcePrivate = false) {
  ensureStorageDirectorySync(dirname(filePath), forcePrivate);
  const tempPath = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeStorageFileSync(tempPath, content, { flag: "wx", forcePrivate });
    renameSync(tempPath, filePath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}
function copyStorageFileSync(sourcePath, destinationPath, forcePrivate = false) {
  ensureStorageDirectorySync(dirname(destinationPath), forcePrivate);
  const privateMode = forcePrivate || shouldEnforcePrivateStoragePermissions();
  const sourceFd = openSync(sourcePath, "r");
  let destinationFd;
  try {
    destinationFd = openSync(destinationPath, "wx", privateMode ? 384 : 438);
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;; ) {
      const bytesRead = readSync(sourceFd, buffer, 0, buffer.length, null);
      if (bytesRead === 0)
        break;
      let offset = 0;
      while (offset < bytesRead) {
        offset += writeSync(destinationFd, buffer, offset, bytesRead - offset);
      }
    }
  } catch (error) {
    if (destinationFd !== undefined)
      rmSync(destinationPath, { force: true });
    throw error;
  } finally {
    closeSync(sourceFd);
    if (destinationFd !== undefined)
      closeSync(destinationFd);
  }
}
function copyStorageTreeSync(sourcePath, destinationPath, forcePrivate = false) {
  const stat = lstatSync(sourcePath);
  if (stat.isSymbolicLink()) {
    ensureStorageDirectorySync(dirname(destinationPath), forcePrivate);
    symlinkSync(readlinkSync(sourcePath), destinationPath);
    return;
  }
  if (!stat.isDirectory()) {
    copyStorageFileSync(sourcePath, destinationPath, forcePrivate);
    return;
  }
  ensureStorageDirectorySync(destinationPath, forcePrivate);
  for (const entry of readdirSync(sourcePath)) {
    copyStorageTreeSync(join(sourcePath, entry), join(destinationPath, entry), forcePrivate);
  }
}
async function writeStorageFileAsync(filePath, content, forcePrivate = false) {
  const privateMode = forcePrivate || shouldEnforcePrivateStoragePermissions();
  ensureStorageDirectorySync(dirname(filePath), privateMode);
  await writeFileAsync(filePath, content, privateMode ? { mode: 384 } : undefined);
}
async function writeStorageFileHandleAsync(handle, content) {
  await handle.writeFile(content);
}
async function createStorageFileHandleAsync(filePath, flags, forcePrivate = false) {
  const privateMode = forcePrivate || shouldEnforcePrivateStoragePermissions();
  return openAsync(filePath, flags, privateMode ? 384 : undefined);
}
function tightenStorageTreeSync(root) {
  if (!shouldEnforcePrivateStoragePermissions() || process.platform === "win32") {
    return { tightened: 0, failures: 0 };
  }
  let tightened = 0;
  let failures = 0;
  const visit = (entryPath) => {
    let stat;
    try {
      stat = lstatSync(entryPath);
    } catch {
      failures++;
      return;
    }
    if (stat.isSymbolicLink())
      return;
    const mode = stat.isDirectory() ? 448 : 384;
    if ((stat.mode & 63) !== 0 || (stat.mode & 511) !== mode) {
      try {
        chmodSync(entryPath, mode);
        tightened++;
      } catch {
        failures++;
      }
    }
    if (!stat.isDirectory())
      return;
    let entries;
    try {
      entries = readdirSync(entryPath);
    } catch {
      failures++;
      return;
    }
    for (const entry of entries)
      visit(join(entryPath, entry));
  };
  visit(root);
  return { tightened, failures };
}

export { setStoragePrivatePermissionEnforcement, shouldEnforcePrivateStoragePermissions, ensureStorageDirectorySync, writeStorageFileSync, writeStorageFileAtomicSync, copyStorageFileSync, copyStorageTreeSync, writeStorageFileAsync, writeStorageFileHandleAsync, createStorageFileHandleAsync, tightenStorageTreeSync };
