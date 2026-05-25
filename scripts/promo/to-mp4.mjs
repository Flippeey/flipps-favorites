/**
 * Convert promo videos (promo/videos/*.webm) to store-ready 1280x720 MP4s
 * suitable for Chrome / Firefox / Edge store submissions.
 *
 *   node scripts/promo/to-mp4.mjs                 # convert all clips
 *   node scripts/promo/to-mp4.mjs --only=search   # subset
 *   node scripts/promo/to-mp4.mjs --src=promo/videos --out=promo/mp4
 *
 * Design:
 *   - Source 1920x1080 → clean scale to 1280x720 (no letterbox, no overlays).
 *   - x264 yuv420p MP4 with +faststart so the file plays as soon as the store
 *     reviewer clicks it.
 *
 * ffmpeg discovery mirrors to-gif.mjs: --ffmpeg flag, FFMPEG_PATH env,
 * ffmpeg-static package, then `ffmpeg` on PATH.
 */

import { spawn } from ‘node:child_process’;
import { readdir, mkdir, stat } from ‘node:fs/promises’;
import { existsSync } from ‘node:fs’;
import { join, basename, extname, dirname, resolve } from ‘node:path’;
import { fileURLToPath } from ‘node:url’;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, ‘..’, ‘..’);

// ─── CLI ────────────────────────────────────────────────────────────────────

function parseArgs() {
  const flags = {
    only: null,
    src: join(ROOT_DIR, ‘promo’, ‘videos’),
    out: join(ROOT_DIR, ‘promo’, ‘mp4’),
    ffmpeg: null,
  };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(‘--only=’))        flags.only = a.slice(7).split(‘,’).map((s) => s.trim());
    else if (a.startsWith(‘--src=’))    flags.src = resolve(a.slice(6));
    else if (a.startsWith(‘--out=’))    flags.out = resolve(a.slice(6));
    else if (a.startsWith(‘--ffmpeg=’)) flags.ffmpeg = a.slice(9);
  }
  return flags;
}

async function locateFfmpeg(explicit) {
  if (explicit) return explicit;
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const mod = await import('ffmpeg-static');
    const path = mod.default ?? mod;
    if (path) return path;
  } catch { /* not installed */ }
  return 'ffmpeg';
}

function run(cmd, args) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', rejectP);
    child.on('close', (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`ffmpeg exited ${code}\n${stderr.trim().split('\n').slice(-6).join('\n')}`));
    });
  });
}

// ─── Conversion ─────────────────────────────────────────────────────────────

async function convert(ffmpeg, src, dest) {
  await run(ffmpeg, [
    '-y',
    '-i', src,
    '-vf', 'scale=1280:720:flags=lanczos',
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-an',
    dest,
  ]);
}

function matchesFilter(name, only) {
  if (!only) return true;
  return only.some((q) => name.includes(q.replace(/^\d+-/, '')));
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const flags = parseArgs();
  if (!existsSync(flags.src)) {
    console.error(`No source directory: ${flags.src}`);
    process.exit(1);
  }
  await mkdir(flags.out, { recursive: true });

  const ffmpeg = await locateFfmpeg(flags.ffmpeg);
  console.log('Using ffmpeg:', ffmpeg);
  console.log('Source:', flags.src);
  console.log('Output:', flags.out);

  const files = (await readdir(flags.src))
    .filter((f) => f.endsWith('.webm'))
    .filter((f) => matchesFilter(basename(f, '.webm'), flags.only))
    .sort();

  if (files.length === 0) {
    console.error('No matching .webm files in', flags.src);
    process.exit(1);
  }

  console.log(`\nConverting ${files.length} clip(s) to 1280x720 MP4.\n`);

  for (const f of files) {
    const name = basename(f, extname(f));
    const src  = join(flags.src, f);
    const dest = join(flags.out, name + '.mp4');
    process.stdout.write(`▶ ${f} → ${basename(dest)} … `);
    try {
      await convert(ffmpeg, src, dest);
      const { size } = await stat(dest);
      console.log(`${(size / 1024 / 1024).toFixed(2)} MB`);
    } catch (err) {
      console.log('FAILED');
      console.error('  ', err.message);
    }
  }

  console.log(`\n✅ Done. MP4s in promo/mp4/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
