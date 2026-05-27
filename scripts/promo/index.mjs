#!/usr/bin/env node
/**
 * Promo material pipeline CLI.
 *
 *   node scripts/promo all            # screenshots + videos
 *   node scripts/promo screenshots    # light + dark screenshots only
 *   node scripts/promo videos         # all 6 videos
 *   node scripts/promo videos --only=workspace-switch,add-bookmark
 *   node scripts/promo videos --list  # show available video names
 *
 * GIF conversion (requires ffmpeg):
 *   for f in promo/videos/*.webm; do
 *     ffmpeg -i "$f" \
 *       -vf "fps=20,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
 *       "${f%.webm}.gif"
 *   done
 */

import { runScreenshots } from './screenshots.mjs';
import { runVideos } from './videos.mjs';

const [, , cmd, ...rest] = process.argv;

const help = `
Usage: node scripts/promo [command] [options]

Commands:
  all           Run screenshots then videos
  screenshots   Capture all 15 scenes in light + dark mode (60 PNGs)
  videos        Record all 7 promo videos (use --only=<names> to filter)

Options:
  --only=<a,b>  (videos only) Comma-separated list of video names
  --list        (videos only) Print available video names
`.trim();

switch (cmd) {
  case 'all':
    await runScreenshots();
    await runVideos();
    break;
  case 'screenshots':
    await runScreenshots();
    break;
  case 'videos':
    await runVideos(rest.find(a => a.startsWith('--only='))?.split('=')[1] ?? null);
    break;
  case '--help':
  case '-h':
  case undefined:
    console.log(help);
    process.exit(0);
    break;
  default:
    console.error(`Unknown command: ${cmd}\n\n${help}`);
    process.exit(1);
}
