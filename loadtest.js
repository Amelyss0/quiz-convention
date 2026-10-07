// =====================================================================
//  Test de charge : lance de faux joueurs ("bots") qui rejoignent la
//  partie et répondent tout seuls, puis affiche si tout s'est bien passé.
//
//  Utilisation :  node loadtest.js <CODE PIN> [nombre de bots] [adresse du site]
//  Exemples :     node loadtest.js 3097 50
//                 node loadtest.js 3097 50 https://quiz-convention.onrender.com
// =====================================================================
const { io } = require('socket.io-client');

const PIN = process.argv[2];
const NB = parseInt(process.argv[3] || '50', 10);
const URL = process.argv[4] || 'http://localhost:3000';
if (!PIN) { console.log('Il manque le code PIN. Exemple : node loadtest.js 3097 50'); process.exit(1); }

console.log(`\nLancement de ${NB} bots sur ${URL} (code ${PIN})…\n`);

const stats = {
  connectes: 0, rejoints: 0, refuses: 0, erreursConnexion: 0, deconnexions: 0, reconnexions: 0,
  tempsRejoindre: [],      // temps de réponse du serveur quand un bot rejoint (ms)
  questions: {}            // pour chaque question : quand chaque bot l'a reçue, combien ont reçu leur résultat
};
const bots = [];
const attendre = ms => new Promise(r => setTimeout(r, ms));
const moyenne = t => t.length ? Math.round(t.reduce((a, b) => a + b, 0) / t.length) : 0;
const max = t => t.length ? Math.max(...t) : 0;

function lancerBot(i) {
  const nom = 'Bot' + String(i + 1).padStart(2, '0');
  const s = io(URL, { reconnection: true, timeout: 20000 });
  let cle = null;

  s.on('connect', () => {
    if (cle) {                                   // le bot revient après une coupure
      stats.reconnexions++;
      s.emit('player:rejoin', { pin: PIN, key: cle }, () => {});
      return;
    }
    stats.connectes++;
    const t0 = Date.now();
    s.emit('player:join', { pin: PIN, name: nom }, r => {
      stats.tempsRejoindre.push(Date.now() - t0);
      if (r.error) { stats.refuses++; console.log(`${nom} refusé : ${r.error}`); return; }
      cle = r.key; stats.rejoints++;
      if (stats.rejoints === NB) console.log(`✔ Les ${NB} bots sont dans la partie. Lance la partie sur l'écran animateur.\n`);
    });
  });
  s.on('connect_error', () => { stats.erreursConnexion++; });
  s.on('disconnect', () => { stats.deconnexions++; });

  // Une question arrive : on note l'heure, puis on répond au hasard après 1 à 8 secondes
  s.on('question', q => {
    const Q = stats.questions[q.n] ||= { recues: [], resultats: 0, total: q.total };
    Q.recues.push(Date.now());
    const delai = 1000 + Math.random() * Math.min(7000, (q.time - 2) * 1000);
    setTimeout(() => {
      if (Math.random() < 0.15) s.emit('player:joker', { type: ['fifty', 'x2', 'shield'][i % 3] }, () => {});
      s.emit('player:answer', { choice: Math.floor(Math.random() * 4) });
    }, delai);
  });
  s.on('result', () => {
    const n = Object.keys(stats.questions).length;
    if (stats.questions[n]) stats.questions[n].resultats++;
  });
  s.on('end', () => { if (i === 0) setTimeout(bilan, 1500); });

  bots.push(s);
}

function bilan() {
  console.log('\n================ BILAN ================');
  console.log(`Bots demandés         : ${NB}`);
  console.log(`Ont rejoint           : ${stats.rejoints}   (refusés : ${stats.refuses})`);
  console.log(`Erreurs de connexion  : ${stats.erreursConnexion}`);
  console.log(`Déconnexions          : ${stats.deconnexions}   (reconnexions : ${stats.reconnexions})`);
  console.log(`Temps pour rejoindre  : moyenne ${moyenne(stats.tempsRejoindre)} ms, pire ${max(stats.tempsRejoindre)} ms`);
  console.log('\nPar question :');
  Object.entries(stats.questions).forEach(([n, Q]) => {
    const ecart = Q.recues.length ? Math.max(...Q.recues) - Math.min(...Q.recues) : 0;
    console.log(`  Question ${n} : reçue par ${Q.recues.length}/${stats.rejoints} bots (écart entre le 1er et le dernier : ${ecart} ms), résultats reçus : ${Q.resultats}/${stats.rejoints}`);
  });
  const ok = stats.rejoints === NB && stats.erreursConnexion === 0 &&
    Object.values(stats.questions).every(Q => Q.recues.length === stats.rejoints && Q.resultats === stats.rejoints);
  console.log('\n' + (ok ? '✅ Tout est bon : le serveur a tenu la charge.' : '⚠️  Il y a eu des problèmes : envoie ce bilan à Claude.'));
  console.log('=======================================\n');
  bots.forEach(s => s.close());
  process.exit(0);
}

// Ctrl + C : on affiche quand même le bilan
process.on('SIGINT', bilan);

(async () => {
  for (let i = 0; i < NB; i++) { lancerBot(i); await attendre(40); }   // un nouveau bot toutes les 40 ms
})();
