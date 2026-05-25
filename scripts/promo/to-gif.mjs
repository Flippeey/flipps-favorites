/**
 * Convert promo videos (promo/videos/*.webm) to high-quality, web-optimized
 * GIFs (promo/gifs/*.gif). Caps every GIF at 15 seconds.
 *
 *   node scripts/promo/to-gif.mjs                  # convert everything
 *   node scripts/promo/to-gif.mjs --only=search    # subset
 *   node scripts/promo/to-gif.mjs --width=720 --fps=15
 *
 * ffmpeg discovery order:
 *   1) explicit --ffmpeg=<path>
 *   2) env FFMPEG_PATH
 *   3) `ffmpeg-static` npm package (install: `npm i -D ffmpeg-static`)
 *   4) `ffmpeg` on PATH
 *
 * Two-pass palette pipeline (generate palette → use palette) keeps colors
 * crisp at small file sizes. `bayer` dithering at scale 5 balances texture
 * vs banding; tweak via flag if needed.
 */

import { spawn } from 'node:child_process';
import { readdir, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..', '..');
const VIDEO_DIR = join(ROOT_DIR, 'promo', 'videos');
const GIF_DIR   = join(ROOT_DIR, 'promo', 'gifs');

function parseArgs() {
  const flags = {
    only: null,
    width: 800,
    fps: 18,
    maxSeconds: 15,
    ffmpeg: null,
    dither: 'bayer:bayer_scale=5',
  };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--only='))       flags.only = a.slice(7).split(',').map((s) => s.trim());
    else if (a.startsWith('--width=')) flags.width = parseInt(a.slice(8), 10);
    else if (a.startsWith('--fps='))   flags.fps   = parseInt(a.slice(6), 10);
    else if (a.startsWith('--max='))   flags.maxSeconds = parseFloat(a.slice(6));
    else if (a.startsWith('--ffmpeg='))flags.ffmpeg = a.slice(9);
    else if (a.startsWith('--dither='))flags.dither = a.slice(9);
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
      else rejectP(new Error(`ffmpeg exited ${code}\n${stderr.trim().split('\n').slice(-4).join('\n')}`));
    });
  });
}

async function convert(ffmpeg, src, dest, { width, fps, maxSeconds, dither }) {
  // Pass 1: generate palette from a representative slice.
  const paletteFile = dest.replace(/\.gif$/, '.palette.png');
  const vf = `fps=${fps},scale=${width}:-2:flags=lanczos`;
  await run(ffmpeg, [
    '-y',
    '-t', String(maxSeconds),
    '-i', src,
    '-vf', `${vf},palettegen=max_colors=192:stats_mode=full`,
    paletteFile,
  ]);
  // Pass 2: encode using palette.
  await run(ffmpeg, [
    '-y',
    '-t', String(maxSeconds),
    '-i', src,
    '-i', paletteFile,
    '-lavfi', `${vf}[x];[x][1:v]paletteuse=dither=${dither}`,
    '-loop', '0',
    dest,
  ]);
  // Discard the palette PNG.
  const { unlink } = await import('node:fs/promises');
  await unlink(paletteFile).catch(() => undefined);
}

function matchesFilter(name, only) {
  if (!only) return true;
  return only.some((q) => name.includes(q.replace(/^\d+-/, '')));
}

async function main() {
  const flags = parseArgs();
  if (!existsSync(VIDEO_DIR)) {
    console.error(`No videos directory: ${VIDEO_DIR}`);
    console.error('Run `node scripts/promo/record.mjs` first.');
    process.exit(1);
  }
  await mkdir(GIF_DIR, { recursive: true });

  const ffmpeg = await locateFfmpeg(flags.ffmpeg);
  console.log('Using ffmpeg:', ffmpeg);

  const files = (await readdir(VIDEO_DIR))
    .filter((f) => f.endsWith('.webm'))
    .filter((f) => matchesFilter(basename(f, '.webm'), flags.only));

  if (files.length === 0) {
    console.error('No matching .webm files in', VIDEO_DIR);
    process.exit(1);
  }

  console.log(`Converting ${files.length} video(s) at ${flags.width}px / ${flags.fps}fps, max ${flags.maxSeconds}s.\n`);

  for (const f of files) {
    const src = join(VIDEO_DIR, f);
    const dest = join(GIF_DIR, basename(f, extname(f)) + '.gif');
    process.stdout.write(`▶ ${f} → ${basename(dest)} … `);
    try {
      await convert(ffmpeg, src, dest, flags);
      const { size } = await stat(dest);
      console.log(`${(size / 1024 / 1024).toFixed(2)} MB`);
    } catch (err) {
      console.log('FAILED');
      console.error('  ', err.message);
    }
  }

  console.log('\n✅ Done. GIFs in promo/gifs/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
