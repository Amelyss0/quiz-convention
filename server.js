const express = require('express'), http = require('http'), { Server } = require('socket.io');
const app = express(), srv = http.createServer(app), io = new Server(srv);
const fs = require('fs'), path = require('path'), crypto = require('crypto');
app.use(express.static('public'));
app.use(express.json({ limit: '1mb' }));
const Q_FILE = path.join(__dirname, 'questions.json');
let Q = JSON.parse(fs.readFileSync(Q_FILE, 'utf-8'));
// Mot de passe de la page d'administration (à définir sur Render dans "Environment")
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'convention';
const START_JOKERS = { fifty: 1, x2: 1, crowd: 1, shield: 1 }; // paramétrable
const MALUS = 200;
let g = null;

const salle = () => 'partie-' + g.pin;   // le "salon" des joueurs de la partie en cours
const questionPourEcran = () => { const q = Q[g.idx]; return { n: g.idx + 1, total: Q.length, text: q.text, options: q.options, time: q.time, showText: g.showText }; };

const ranking = () => Object.entries(g.players).map(([id, p]) => ({ id, name: p.name, score: p.score })).sort((a, b) => b.score - a.score);

function nextQ() {
  g.idx++;
  if (g.idx >= Q.length) {
    g.state = 'end';
    g.top = ranking().slice(0, 5).map(({ name, score }) => ({ name, score }));
    io.to(salle()).to(g.host).emit('end', g.top);
    return;
  }
  const q = Q[g.idx];
  g.state = 'question'; g.t0 = Date.now();
  Object.values(g.players).forEach(p => { p.ans = null; p.x2 = false; p.shield = false; p.removed = []; p.result = null; });
  io.to(salle()).to(g.host).emit('question', questionPourEcran());
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
  r.forEach((e, i) => {
    const p = g.players[e.id];
    p.result = { pts: p.last, score: e.score, rank: i + 1, total: r.length, correct: q.correct, option: q.options[q.correct] };
    io.to(p.sid).emit('result', p.result);
  });
  g.lastReveal = { correct: q.correct, counts, board: r.slice(0, 5).map(({ name, score }) => ({ name, score })) };
  io.to(g.host).emit('reveal', g.lastReveal);
}

// ---------- Administration des questions ----------
const isAdmin = req => req.get('x-admin-password') === ADMIN_PASSWORD;

function checkQuestions(list) {
  if (!Array.isArray(list) || list.length === 0) return 'Il faut au moins une question.';
  for (let i = 0; i < list.length; i++) {
    const q = list[i], n = `Question ${i + 1} : `;
    if (!q || typeof q.text !== 'string' || !q.text.trim()) return n + 'le texte est vide.';
    if (!Array.isArray(q.options) || q.options.length !== 4 || q.options.some(o => typeof o !== 'string' || !o.trim())) return n + 'il faut 4 réponses remplies.';
    if (![0, 1, 2, 3].includes(q.correct)) return n + 'choisis la bonne réponse.';
    if (!Number.isInteger(q.time) || q.time < 5 || q.time > 120) return n + 'le temps doit être entre 5 et 120 secondes.';
  }
  return null;
}

app.get('/api/questions', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Mot de passe incorrect.' });
  res.json(Q);
});

app.put('/api/questions', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Mot de passe incorrect.' });
  if (g && (g.state === 'question' || g.state === 'reveal')) return res.status(409).json({ error: 'Une partie est en cours : attends la fin pour enregistrer.' });
  const list = (req.body || []).map(q => ({
    text: String(q.text || '').trim(),
    options: (q.options || []).map(o => String(o || '').trim()),
    correct: Number(q.correct),
    time: Number(q.time)
  }));
  const err = checkQuestions(list);
  if (err) return res.status(400).json({ error: err });
  fs.writeFileSync(Q_FILE, JSON.stringify(list, null, 2), 'utf-8');
  Q = list;
  res.json({ ok: true, count: Q.length });
});

// Chaque joueur reçoit une "clé" secrète gardée sur son téléphone.
// C'est elle qui l'identifie (et pas sa connexion), pour qu'il puisse revenir s'il est déconnecté.
const joueurDe = s => g && s.data.key && g.players[s.data.key];

// Ce qu'un joueur qui revient doit voir, selon le moment de la partie
function etatPourJoueur(p) {
  const base = { jokers: p.jokers, name: p.name, score: p.score };
  if (g.state === 'question') {
    return { ...base, state: 'question', answered: !!p.ans, removed: p.removed, question: questionPourEcran() };
  }
  if (g.state === 'reveal' && p.result) return { ...base, state: 'result', result: p.result };
  if (g.state === 'end') return { ...base, state: 'end' };
  return { ...base, state: 'lobby' };
}

// Ce que l'écran animateur doit réafficher s'il revient (page rechargée, connexion coupée…)
function etatPourHote() {
  const base = { pin: g.pin, players: Object.values(g.players).map(p => p.name), showText: g.showText };
  if (g.state === 'question') {
    const q = Q[g.idx];
    return { ...base, state: 'question', question: questionPourEcran(),
      remaining: Math.max(0, Math.ceil(q.time - (Date.now() - g.t0) / 1000)),
      done: Object.values(g.players).filter(x => x.ans).length };
  }
  if (g.state === 'reveal') return { ...base, state: 'reveal', question: questionPourEcran(), reveal: g.lastReveal };
  if (g.state === 'end') return { ...base, state: 'end', top: g.top };
  return { ...base, state: 'lobby' };
}

io.on('connection', s => {
  // L'écran animateur s'ouvre. Il garde une "clé d'animateur" secrète dans l'onglet :
  //  - avec la bonne clé, il reprend sa partie (même après un rechargement) ;
  //  - sans la clé, il ne peut pas écraser une partie en cours, sauf avec le mot de passe admin.
  s.on('host:create', ({ pin, key, nouvelle, password } = {}) => {
    const estHote = g && pin === g.pin && key === g.hostKey;
    if (estHote && !nouvelle) { g.host = s.id; return s.emit('host:state', etatPourHote()); }
    const enCours = g && g.state !== 'end' && Object.keys(g.players).length > 0;
    if (enCours && !estHote && password !== ADMIN_PASSWORD) return s.emit('host:busy', { wrong: password !== undefined });
    if (g) clearTimeout(g.timer);
    g = { pin: String(1000 + Math.floor(Math.random() * 9000)), hostKey: crypto.randomUUID(), state: 'lobby', idx: -1, players: {}, host: s.id, showText: false };
    s.emit('host:created', { pin: g.pin, key: g.hostKey });
  });
  s.on('host:opts', v => { if (g && s.id === g.host) g.showText = !!v; });
  s.on('host:next', () => {
    if (!g || s.id !== g.host) return;
    if (g.state === 'question') reveal(); else if (g.state !== 'end') nextQ();
  });
  s.on('player:join', ({ pin, name }, cb) => {
    if (!g || pin !== g.pin || g.state !== 'lobby') return cb({ error: 'Code invalide ou partie déjà lancée.' });
    const key = crypto.randomUUID();
    g.players[key] = { sid: s.id, name: String(name || 'Joueur').replace(/[<>&"'`]/g, '').slice(0, 16) || 'Joueur', score: 0, jokers: { ...START_JOKERS }, removed: [] };
    s.data.key = key; s.join(salle());
    io.to(g.host).emit('host:players', Object.values(g.players).map(p => p.name));
    cb({ ok: true, jokers: g.players[key].jokers, key, pin: g.pin, name: g.players[key].name });
  });
  // Un joueur revient (téléphone verrouillé, Wi-Fi coupé, page rechargée…)
  s.on('player:rejoin', ({ pin, key } = {}, cb = () => {}) => {
    const p = g && pin === g.pin && g.players[key];
    if (!p) return cb({ error: 'Partie introuvable.' });
    p.sid = s.id; s.data.key = key; s.join(salle());
    cb({ ok: true, ...etatPourJoueur(p) });
  });
  s.on('player:answer', ({ choice }) => {
    const p = joueurDe(s);
    if (!p || g.state !== 'question' || p.ans) return;
    p.ans = { choice, t: Date.now() - g.t0 };
    const done = Object.values(g.players).filter(x => x.ans).length;
    io.to(g.host).emit('host:count', { done, total: Object.keys(g.players).length });
    if (done === Object.keys(g.players).length) reveal();
  });
  s.on('player:joker', ({ type }, cb) => {
    const p = joueurDe(s);
    if (!p || g.state !== 'question' || p.ans || !(p.jokers[type] > 0)) return cb({ error: 'Joker indisponible.' });
    const q = Q[g.idx];
    let res = {};
    if (type === 'fifty') {
      const wrong = [0, 1, 2, 3].filter(i => i !== q.correct).sort(() => Math.random() - 0.5).slice(0, 2);
      res = { remove: wrong }; p.removed = wrong;
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

srv.listen(process.env.PORT || 3000, () => {
  console.log('Quiz sur http://localhost:3000/host.html');
  console.log('Questions sur http://localhost:3000/admin.html');
});
