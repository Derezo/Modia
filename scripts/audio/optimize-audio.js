#!/usr/bin/env node
/**
 * Audio Optimization Script
 *
 * Re-encodes MP3 files under frontend/public/assets/audio as Opus (.opus) in
 * a parallel tree. The app can then prefer .opus when the browser supports it
 * (every modern mobile browser does) and fall back to .mp3 otherwise.
 *
 * Opus at 64 kbps mono / 96 kbps stereo is roughly transparent for music and
 * cuts file size by 40–60% vs the current 156 kbps MP3s.
 *
 * Usage:
 *   node scripts/audio/optimize-audio.js                  # re-encode all music+sfx
 *   node scripts/audio/optimize-audio.js --dir audio/sfx  # one subdir
 *   node scripts/audio/optimize-audio.js --dry-run        # list what would run
 *   node scripts/audio/optimize-audio.js --music-bitrate 80k
 *   node scripts/audio/optimize-audio.js --sfx-bitrate 48k
 *   node scripts/audio/optimize-audio.js --force          # re-encode even if .opus exists
 *
 * Requires: ffmpeg on PATH.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const ASSET_ROOT = path.join(PROJECT_ROOT, 'frontend/public/assets/audio');

function parseArgs() {
  const argv = process.argv.slice(2);
  const opts = {
    dir: null,
    dryRun: false,
    force: false,
    musicBitrate: '96k',
    sfxBitrate: '64k'
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--dir') opts.dir = argv[++i];
    else if (a === '--music-bitrate') opts.musicBitrate = argv[++i];
    else if (a === '--sfx-bitrate') opts.sfxBitrate = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 22).join('\n'));
      process.exit(0);
    }
  }
  return opts;
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && entry.name.endsWith('.mp3')) yield full;
  }
}

function pickBitrate(mp3Path, opts) {
  // music/ and ambient/ -> music bitrate; sfx/ ui/ interactions/ -> sfx bitrate
  if (/\/(sfx|ui|interactions)\//.test(mp3Path)) return opts.sfxBitrate;
  return opts.musicBitrate;
}

function encode(mp3Path, opusPath, bitrate) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y', '-loglevel', 'error',
      '-i', mp3Path,
      '-c:a', 'libopus',
      '-b:a', bitrate,
      '-vbr', 'on',
      '-compression_level', '10',
      '-application', 'audio',
      opusPath
    ];
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.trim()}`));
    });
  });
}

async function main() {
  const opts = parseArgs();
  const rootDir = opts.dir ? path.join(PROJECT_ROOT, opts.dir) : ASSET_ROOT;

  if (!fs.existsSync(rootDir)) {
    console.error(`Not a directory: ${rootDir}`);
    process.exit(1);
  }

  const files = Array.from(walk(rootDir));
  if (files.length === 0) {
    console.log(`No .mp3 files under ${path.relative(PROJECT_ROOT, rootDir)}`);
    return;
  }

  let totalMp3 = 0;
  let totalOpusEstimate = 0;
  let encoded = 0;
  let skipped = 0;
  let failed = 0;

  for (const mp3Path of files) {
    const opusPath = mp3Path.replace(/\.mp3$/, '.opus');
    const bitrate = pickBitrate(mp3Path, opts);
    const relative = path.relative(PROJECT_ROOT, mp3Path);
    const mp3Bytes = fs.statSync(mp3Path).size;
    totalMp3 += mp3Bytes;

    if (!opts.force && fs.existsSync(opusPath)) {
      totalOpusEstimate += fs.statSync(opusPath).size;
      skipped++;
      continue;
    }

    if (opts.dryRun) {
      console.log(`[dry] ${relative} -> .opus @ ${bitrate}`);
      continue;
    }

    process.stdout.write(`[${encoded + 1}/${files.length}] ${relative} @ ${bitrate} ... `);
    try {
      await encode(mp3Path, opusPath, bitrate);
      const opusBytes = fs.statSync(opusPath).size;
      totalOpusEstimate += opusBytes;
      encoded++;
      const pct = (100 * (1 - opusBytes / mp3Bytes)).toFixed(1);
      console.log(`${(mp3Bytes / 1048576).toFixed(2)}MB -> ${(opusBytes / 1048576).toFixed(2)}MB (${pct}% smaller)`);
    } catch (err) {
      failed++;
      console.log(`FAIL: ${err.message}`);
    }
  }

  console.log('');
  console.log(`Summary: encoded=${encoded}, skipped=${skipped}, failed=${failed}`);
  if (totalMp3 > 0) {
    console.log(`Total MP3: ${(totalMp3 / 1048576).toFixed(1)}MB`);
    console.log(`Total Opus (new+existing): ${(totalOpusEstimate / 1048576).toFixed(1)}MB`);
    if (totalOpusEstimate > 0) {
      const saved = (100 * (1 - totalOpusEstimate / totalMp3)).toFixed(1);
      console.log(`Bandwidth saved if Opus served: ${saved}%`);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
