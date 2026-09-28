const express = require('express'), http = require('http'), { Server } = require('socket.io');
const app = express(), srv = http.createServer(app), io = new Server(srv);
app.use(express.static('public'));
const Q = require('./questions.json');
const START_JOKERS = { fifty: 1, x2: 1, crowd: 1, shield: 1 }; // paramétrable
const MALUS = 200;
let g = null;

const ranking = () => Object.entries(g.players).map(([id, p]) => ({ id, name: p.name, score: p.score })).sort((a, b) => b.score - a.score);

function nextQ() {
  g.idx++;
  if (g.idx >= Q.length) { g.state = 'end'; io.emit('end', ranking().slice(0, 3)); return; }
  const q = Q[g.idx];
  g.state = 'question'; g.t0 = Date.now();
  Object.values(g.players).forEach(p => { p.ans = null; p.x2 = false; p.shield = false; });
  io.emit('question', { n: g.idx + 1, total: Q.length, text: q.text, options: q.options, time: q.time });
  g.timer = setTimeout(reveal, q.time * 1000);
}

function reveal() {
  if (g.state !== 'question') return;
  clearTimeout(g.timer); g.state = 'reveal';
  const q = Q[g.idx], counts = [0, 0, 0, 0];
  Object.values(g.players).forEach(p => {
    let pts = 0;
    if (p.ans) {
      counts[p.ans.choice]++;
      if (p.ans.choice === q.correct) { pts = Math.round(1000 * (1 - p.ans.t / (q.time * 1000) / 2)); if (p.x2) pts *= 2; }
      else if (!p.shield) pts = -MALUS;
    }
    p.score = Math.max(0, p.score + pts); p.last = pts;
  });
  const r = ranking();
  r.forEach((e, i) => io.to(e.id).emit('result', { pts: g.players[e.id].last, score: e.score, rank: i + 1, total: r.length, correct: q.correct }));
  io.to(g.host).emit('reveal', { correct: q.correct, counts, board: r.slice(0, 5) });
}

io.on('connection', s => {
  s.on('host:create', () => {
    g = { pin: String(1000 + Math.floor(Math.random() * 9000)), state: 'lobby', idx: -1, players: {}, host: s.id };
    s.emit('host:created', { pin: g.pin });
  });
  s.on('host:next', () => {
    if (!g || s.id !== g.host) return;
    if (g.state === 'question') reveal(); else if (g.state !== 'end') nextQ();
  });
  s.on('player:join', ({ pin, name }, cb) => {
    if (!g || pin !== g.pin || g.state !== 'lobby') return cb({ error: 'Code invalide ou partie déjà lancée.' });
    g.players[s.id] = { name: String(name || 'Joueur').slice(0, 16), score: 0, jokers: { ...START_JOKERS } };
    io.to(g.host).emit('host:players', Object.values(g.players).map(p => p.name));
    cb({ ok: true, jokers: g.players[s.id].jokers });
  });
  s.on('player:answer', ({ choice }) => {
    const p = g && g.players[s.id];
    if (!p || g.state !== 'question' || p.ans) return;
    p.ans = { choice, t: Date.now() - g.t0 };
    const done = Object.values(g.players).filter(x => x.ans).length;
    io.to(g.host).emit('host:count', { done, total: Object.keys(g.players).length });
    if (done === Object.keys(g.players).length) reveal();
  });
  s.on('player:joker', ({ type }, cb) => {
    const p = g && g.players[s.id];
    if (!p || g.state !== 'question' || p.ans || !(p.jokers[type] > 0)) return cb({ error: 'Joker indisponible.' });
    const q = Q[g.idx];
    let res = {};
    if (type === 'fifty') {
      const wrong = [0, 1, 2, 3].filter(i => i !== q.correct).sort(() => Math.random() - 0.5).slice(0, 2);
      res = { remove: wrong };
    } else if (type === 'crowd') {
      const votes = [0, 0, 0, 0], all = Object.values(g.players).filter(x => x.ans);
      all.forEach(x => votes[x.ans.choice]++);
      if (all.length < 3) return cb({ error: 'Pas assez de votes pour le moment.' });
      res = { percent: votes.map(v => Math.round(v / all.length * 100)) };
    } else if (type === 'x2') p.x2 = true;
    else if (type === 'shield') p.shield = true;
    else return cb({ error: 'Joker inconnu.' });
    p.jokers[type]--;
    cb({ ok: true, jokers: p.jokers, ...res });
  });
});

srv.listen(process.env.PORT || 3000, () => console.log('Quiz sur http://localhost:3000/host.html'));
