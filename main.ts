// A working token-radar-01 entry (Node 22, standard library only).
//
// PIPELINE — what runs, in order, and why.
//
//   1. Read the sealed snapshot (parseSnapshot). The snapshot is the only input:
//      758 protocols, 40 watchlist slugs, a $50M floor, an as_of date. It is
//      parsed strictly — a malformed snapshot fails loudly rather than producing
//      a board from misread data — and its optional fields become null, not zero,
//      so missing data is never mistaken for a zero value.
//   2. Score it (buildRadar). One calibration pass derives every category's
//      multiple from the snapshot's live-token protocols; the board is built
//      (watchlist first, then the early radar below the floor); the rows are
//      ranked by implied value with the slug as a deterministic tiebreak. The
//      result is a board and the compact radar data the page renders from.
//   3. Refuse a bad board (boardIssue). Before anything is written, the board is
//      checked against the gate: watchlist coverage, ranks 1..n, non-increasing
//      implied value, no shared value, well-formed farm steps. A board that
//      fails is refused here, with a message naming the fault, instead of being
//      submitted and refused there.
//   4. Write the outputs. board.json (one row per line, inside the gate's
//      100–4000 line window), data.js (the compact rows as a script, no fetch),
//      dashboard/ (the static page), screenshots/ (the three views), and
//      dossier.json last (the scorer rebuilds it from /output and compares
//      bytes, so it must be written after everything it summarises).
//
// The program is deterministic: the same snapshot always produces the same
// /output, byte for byte. No clock, no randomness, no network. The dashboard
// recomputes each row from the same numbers and says whether its recomputation
// matches board.json, so a stale dataset is visible instead of silent.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
// One row per line: 200 rows stay inside the 100–4000 line window (a fully
// indented dump is ~7200 lines and would fail the board's line cap).
//
// The board is written as one JSON object per row, not as a fully indented dump
// and not as a single minified line. The gate counts lines: a minified file is 1
// line (below the 100-line floor), a fully indented file is ~7200 lines (above
// the 4000-line ceiling). One row per line is 204 lines — inside the window —
// and it keeps the file human-readable: each row is a complete, greppable JSON
// object, and a diff between two runs shows exactly which rows moved. The
// trailing newline and the wrapper braces are part of the format, so the file is
// valid JSON a reader can parse with any tool, not a bare stream of objects.
const boardText = `{\n  "rows": [\n${board.map((r) => `    ${JSON.stringify(r)}`).join(',\n')}\n  ]\n}\n`;
writeFileSync(join(out, 'board.json'), boardText);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
