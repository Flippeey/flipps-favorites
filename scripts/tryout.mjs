#!/usr/bin/env node
// Launches a built extension in a dedicated Windows browser profile so it can be tried out
// without disturbing the real installed extension. Only one extension can own the new tab
// per browser profile, so a separate profile (not just a separate tab) is required.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

const usage = 'Usage: npm run tryout -- chrome|firefox [--from <path>] [--dry-run]';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const target = argv[0];
  if (target !== 'chrome' && target !== 'firefox') {
    fail(usage);
  }

  let from;
  let dryRun = false;
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--from') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        fail(usage);
      }
      // npm runs scripts from the package root; INIT_CWD is where the user typed the command.
      from = resolve(process.env.INIT_CWD ?? process.cwd(), value);
      i += 1;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else {
      fail(usage);
    }
  }

  return { target, from, dryRun };
}

function runWslInterop(command) {
  try {
    // cmd.exe warns about UNC paths when started from a WSL directory, so start it from C:.
    return execFileSync('cmd.exe', ['/c', command], {
      encoding: 'utf8',
      cwd: '/mnt/c',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

function resolveLocalAppData() {
  const raw = runWslInterop('echo %LOCALAPPDATA%');
  if (!raw || raw.includes('%LOCALAPPDATA%')) {
    fail(
      'Could not resolve %LOCALAPPDATA% via cmd.exe — this script requires WSL2 with Windows interop enabled.',
    );
  }
  return raw;
}

function toUnixPath(windowsPath) {
  return execFileSync('wslpath', ['-u', windowsPath], { encoding: 'utf8' }).trim();
}

function resolveDist(target, from) {
  if (from) {
    const distDir = join(from, 'dist', target);
    if (!existsSync(join(distDir, 'manifest.json'))) {
      fail(`No built extension found at ${distDir} (expected manifest.json) — build it first.`);
    }
    return distDir;
  }

  execFileSync('npm', ['run', `build:${target}`], { stdio: 'inherit' });
  const distDir = join('dist', target);
  if (!existsSync(join(distDir, 'manifest.json'))) {
    fail(`Build succeeded but ${distDir}/manifest.json is missing.`);
  }
  return distDir;
}

function resolveExe(target) {
  const envVar = target === 'chrome' ? 'TRYOUT_CHROME_EXE' : 'TRYOUT_FIREFOX_EXE';
  const defaultPath =
    target === 'chrome'
      ? '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe'
      : '/mnt/c/Program Files/Mozilla Firefox/firefox.exe';
  const exePath = process.env[envVar] ?? defaultPath;
  if (!existsSync(exePath)) {
    fail(`Browser executable not found at ${exePath} — set ${envVar} to override.`);
  }
  return exePath;
}

function stageExtension(distDir, extensionDir) {
  rmSync(extensionDir, { recursive: true, force: true });
  mkdirSync(extensionDir, { recursive: true });
  cpSync(distDir, extensionDir, { recursive: true });
}

const firefoxUserJs = `user_pref("extensions.webextensions.keepStorageOnUninstall", true);
user_pref("extensions.webextensions.keepUuidOnUninstall", true);
user_pref("browser.shell.checkDefaultBrowser", false);
`;

function main() {
  const { target, from, dryRun } = parseArgs(process.argv.slice(2));

  const exePath = resolveExe(target);
  const distDir = resolveDist(target, from);

  const localAppData = resolveLocalAppData();
  const rootWin = `${localAppData}\\FlippsFavoritesTryout\\${target}`;
  const rootUnix = toUnixPath(rootWin);
  const extensionDirUnix = join(rootUnix, 'extension');
  const extensionDirWin = `${rootWin}\\extension`;
  const profileDirUnix = join(rootUnix, 'profile');
  const profileDirWin = `${rootWin}\\profile`;

  const profileIsNew = !existsSync(profileDirUnix);

  stageExtension(distDir, extensionDirUnix);

  let args;
  if (target === 'chrome') {
    args = [
      `--user-data-dir=${profileDirWin}`,
      '--no-first-run',
      '--no-default-browser-check',
      'chrome://extensions/',
    ];
  } else {
    if (profileIsNew) {
      mkdirSync(profileDirUnix, { recursive: true });
      writeFileSync(join(profileDirUnix, 'user.js'), firefoxUserJs);
    }
    args = ['-profile', profileDirWin, '-no-remote', 'about:debugging#/runtime/this-firefox'];
  }

  console.log(`Staged ${target} extension: ${extensionDirWin}`);
  console.log(`Launch command: ${exePath} ${args.join(' ')}`);

  if (target === 'chrome') {
    if (profileIsNew) {
      console.log(
        `One-time setup: enable Developer mode, then "Load unpacked" and pick ${extensionDirWin}`,
      );
    }
    console.log('If the profile was already open, click "Reload" on the extension card.');
  } else {
    console.log(
      `Click "Load Temporary Add-on" and pick ${extensionDirWin}\\manifest.json (this is required every session — temporary add-ons don't survive a restart, but data persists via the profile prefs).`,
    );
  }

  if (dryRun) {
    console.log('Dry run: browser not launched.');
    return;
  }

  const child = spawn(exePath, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

main();
