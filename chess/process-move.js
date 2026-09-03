'use strict';

// Community chess engine for the snehildwivedi03 GitHub profile.
// Triggered by a GitHub Action when someone opens an issue titled:
//   chess|move|<from><to>[promotion]   e.g. chess|move|e2e4
//   chess|new                          starts a fresh game
// It validates the move with chess.js, updates state + the README board,
// then comments on and closes the issue. Run with no ISSUE_TITLE locally to
// (re)render the starting position.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { Chess } = require('chess.js');

const REPO = 'snehildwivedi03/snehildwivedi03';
const DIR = __dirname;
const ROOT = path.resolve(DIR, '..');
const STATE = path.join(DIR, 'state.json');
const README = path.join(ROOT, 'README.md');
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const title = (process.env.ISSUE_TITLE || '').trim();
const issue = process.env.ISSUE_NUMBER || '';
const actor = process.env.ACTOR || 'a visitor';

function gh(args) {
  try {
    execSync(`gh ${args}`, { stdio: 'inherit' });
  } catch (err) {
    console.error('gh command failed:', err.message);
  }
}

function comment(body) {
  if (!issue) return;
  const file = path.join(os.tmpdir(), `chess-comment-${issue}.md`);
  fs.writeFileSync(file, body);
  gh(`issue comment ${issue} --repo ${REPO} --body-file "${file}"`);
}

function closeIssue() {
  if (issue) gh(`issue close ${issue} --repo ${REPO}`);
}

function loadState() {
  if (!fs.existsSync(STATE)) return null;
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'));
  } catch (_) {
    return null;
  }
}

function saveState(state) {
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
}

function boardUrl(fen, lastMove) {
  const placement = fen.split(' ')[0];
  let url = `https://backscattering.de/web-boardimage/board.png?fen=${placement}&coordinates=true&size=360`;
  if (lastMove) url += `&lastMove=${lastMove}`;
  return url;
}

function issueLink(rawTitle, help) {
  const t = encodeURIComponent(rawTitle);
  const b = encodeURIComponent(help);
  return `https://github.com/${REPO}/issues/new?title=${t}&body=${b}`;
}

function moveLinks(chess) {
  const seen = new Set();
  const items = [];
  for (const m of chess.moves({ verbose: true })) {
    if (m.promotion && m.promotion !== 'q') continue; // offer queen promotion only
    const code = m.from + m.to + (m.promotion || '');
    if (seen.has(code)) continue;
    seen.add(code);
    const href = issueLink(
      `chess|move|${code}`,
      'Press "Submit new issue" to play this move. You do not need to change anything.'
    );
    items.push(`<a href="${href}">${m.san}</a>`);
  }
  return items;
}

function renderBlock(chess, state) {
  const lines = [];
  lines.push('<!-- CHESS:START -->');
  lines.push('<p align="center">');
  lines.push(
    `  <img src="${boardUrl(chess.fen(), state.lastMove)}" alt="Live community chess board on Snehil Dwivedi (snehildwivedi03) GitHub profile" width="360" />`
  );
  lines.push('</p>');
  lines.push('');

  const over = chess.game_over();
  if (over) {
    let status;
    if (chess.in_checkmate()) {
      const winner = chess.turn() === 'w' ? 'Black' : 'White';
      status = `**Checkmate &mdash; ${winner} wins!** &#127942;`;
    } else if (chess.in_stalemate()) {
      status = '**Stalemate &mdash; the game is a draw.**';
    } else {
      status = '**The game is a draw.**';
    }
    lines.push(status);
    lines.push('');
    const href = issueLink('chess|new', 'Press "Submit new issue" to start a fresh game.');
    lines.push(`<p align="center"><a href="${href}"><b>&#9851; Start a new game</b></a></p>`);
  } else {
    const turn = chess.turn() === 'w' ? 'White' : 'Black';
    const check = chess.in_check() ? ' &mdash; _Check!_' : '';
    lines.push(`<p align="center"><b>${turn} to move${check}</b> &nbsp;&middot;&nbsp; click a move, then press <b>Submit new issue</b></p>`);
    lines.push('');
    lines.push('<p align="center">');
    lines.push('  ' + moveLinks(chess).join(' &nbsp;&middot;&nbsp; '));
    lines.push('</p>');
  }

  if (state.history && state.history.length) {
    const recent = state.history.slice(-8).map((h) => h.san).join(' ');
    lines.push('');
    lines.push(`<p align="center"><sub>Recent moves: ${recent}</sub></p>`);
  }

  lines.push('<!-- CHESS:END -->');
  return lines.join('\n');
}

function updateReadme(block) {
  let md = fs.readFileSync(README, 'utf8');
  const re = /<!-- CHESS:START -->[\s\S]*?<!-- CHESS:END -->/;
  if (re.test(md)) {
    md = md.replace(re, block);
  } else {
    md += '\n\n' + block + '\n';
  }
  fs.writeFileSync(README, md);
}

function startNewGame() {
  const state = { fen: START_FEN, lastMove: null, history: [] };
  const chess = new Chess(state.fen);
  saveState(state);
  updateReadme(renderBlock(chess, state));
}

function main() {
  const parts = title.split('|').map((s) => s.trim());
  const cmd = parts[1] || (title ? '' : 'new');

  if (cmd === 'new') {
    startNewGame();
    comment('&#9823; A new game has started. White to move &mdash; head to the profile to play!');
    closeIssue();
    return;
  }

  let state = loadState();
  if (!state) {
    startNewGame();
    state = loadState();
  }

  if (cmd !== 'move') {
    comment('Unrecognised command. Use the move links on the profile to play.');
    closeIssue();
    return;
  }

  const code = (parts[2] || '').toLowerCase();
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(code)) {
    comment(`&#10060; \`${code || '(empty)'}\` is not a valid move code. Please use a move link from the profile.`);
    closeIssue();
    return;
  }

  const from = code.slice(0, 2);
  const to = code.slice(2, 4);
  const promotion = code.slice(4, 5) || 'q';

  const chess = new Chess(state.fen);
  if (chess.game_over()) {
    comment('This game is already over. Start a new game from the profile.');
    closeIssue();
    return;
  }

  let result = null;
  try {
    result = chess.move({ from, to, promotion });
  } catch (_) {
    result = null;
  }
  if (!result) {
    comment(`&#10060; \`${from}${to}\` is not a legal move right now. Please pick one of the highlighted moves on the profile.`);
    closeIssue();
    return;
  }

  state.fen = chess.fen();
  state.lastMove = from + to;
  state.history.push({ san: result.san, by: actor, at: new Date().toISOString() });
  saveState(state);
  updateReadme(renderBlock(chess, state));

  let msg;
  if (chess.game_over()) {
    if (chess.in_checkmate()) {
      const winner = chess.turn() === 'w' ? 'Black' : 'White';
      msg = `&#9823; **${result.san}** &mdash; Checkmate! ${winner} wins. &#127942; Thanks for playing, @${actor}! Start a new game from the profile.`;
    } else {
      msg = `&#9823; **${result.san}** &mdash; the game is a draw. Thanks for playing, @${actor}!`;
    }
  } else {
    const turn = chess.turn() === 'w' ? 'White' : 'Black';
    const check = chess.in_check() ? ' (Check!)' : '';
    msg = `&#9989; Played **${result.san}** for @${actor}. It is now **${turn}**'s move${check} &mdash; head back to the profile to play the next one!`;
  }
  comment(msg);
  closeIssue();
}

main();
