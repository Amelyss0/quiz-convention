// =====================================================================
//  Sons du quiz — tout est fabriqué par le navigateur (Web Audio API) :
//  pas de fichier MP3 à télécharger, donc pas de souci de droits d'auteur.
// =====================================================================
const Sons = (() => {
  let ctx = null;            // le "moteur audio" du navigateur
  let master = null;         // volume général
  let sonsActifs = true;     // bouton 🔊
  let musiqueActive = true;  // bouton 🎵
  let musique = null;        // la boucle de musique en cours (ou null)

  // Le navigateur interdit le son tant qu'on n'a pas cliqué sur la page :
  // on crée / réveille le moteur audio au premier clic.
  function demarrer() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.6;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    majBoutons();
  }
  const pret = () => ctx && ctx.state === 'running';

  // Joue une note : fréquence (Hz), début (s), durée (s), forme d'onde, volume
  function note(freq, debut = 0, duree = 0.15, forme = 'square', volume = 0.15, sortie = master) {
    const t = ctx.currentTime + debut;
    const osc = ctx.createOscillator(), env = ctx.createGain();
    osc.type = forme;
    osc.frequency.setValueAtTime(freq, t);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(volume, t + 0.01);    // attaque rapide
    env.gain.exponentialRampToValueAtTime(0.0001, t + duree);   // puis ça s'éteint
    osc.connect(env).connect(sortie);
    osc.start(t); osc.stop(t + duree + 0.05);
  }

  // Petite aide : joue un son seulement si c'est autorisé
  const jouer = fn => () => { if (sonsActifs && pret()) fn(); };

  // ---------- Les effets sonores ----------
  const effets = {
    // Un joueur rejoint la partie : petit "pop"
    arrivee: jouer(() => { note(660, 0, 0.08, 'sine', 0.25); note(990, 0.06, 0.12, 'sine', 0.2); }),

    // Nouvelle question : trois notes qui montent
    question: jouer(() => { [523, 659, 784].forEach((f, i) => note(f, i * 0.09, 0.18, 'square', 0.12)); }),

    // Tic-tac du chrono (plus aigu et plus fort sur les 5 dernières secondes)
    tic: restant => { if (sonsActifs && pret()) note(restant <= 5 ? 1200 : 800, 0, 0.05, 'square', restant <= 5 ? 0.12 : 0.05); },

    // Révélation de la bonne réponse : "ding ding"
    revelation: jouer(() => { note(880, 0, 0.35, 'triangle', 0.3); note(1320, 0.15, 0.5, 'triangle', 0.25); }),

    // Podium : petite fanfare
    podium: jouer(() => {
      [[523, 0], [659, 0.15], [784, 0.3], [1047, 0.45], [784, 0.7], [1047, 0.85]]
        .forEach(([f, d]) => note(f, d, d >= 0.85 ? 0.8 : 0.2, 'square', 0.13));
    })
  };

  // ---------- Musique d'attente pendant les questions ----------
  // Une boucle simple : basse + arpège, à faible volume.
  const BASSE = [130.8, 130.8, 174.6, 196.0];                 // Do Do Fa Sol
  const ARPEGE = [[523, 659, 784, 659], [523, 659, 784, 659], [698, 880, 1047, 880], [784, 988, 1175, 988]];

  function lancerMusique() {
    arreterMusique();
    if (!musiqueActive || !sonsActifs || !pret()) return;
    const bus = ctx.createGain(); bus.gain.value = 0.3; bus.connect(master);   // 0.3 = volume de la musique (0 = muet, 1 = fort)
    const pas = 0.18;                    // durée d'une croche (secondes)
    let i = 0, prochain = ctx.currentTime + 0.05;
    // Toutes les 50 ms on programme les notes qui arrivent bientôt
    const minuterie = setInterval(() => {
      while (prochain < ctx.currentTime + 0.2) {
        const mesure = Math.floor(i / 4) % 4, temps = i % 4;
        if (temps === 0) note(BASSE[mesure], prochain - ctx.currentTime, pas * 3.5, 'triangle', 0.18, bus);
        note(ARPEGE[mesure][temps], prochain - ctx.currentTime, pas * 0.9, 'square', 0.04, bus);
        prochain += pas; i++;
      }
    }, 50);
    musique = { minuterie, bus };
  }

  function arreterMusique() {
    if (!musique) return;
    clearInterval(musique.minuterie);
    const { bus } = musique; musique = null;
    bus.gain.setTargetAtTime(0, ctx.currentTime, 0.05);   // fondu rapide
    setTimeout(() => bus.disconnect(), 400);
  }

  // ---------- Boutons 🔊 et 🎵 en haut à droite ----------
  function majBoutons() {
    const s = document.getElementById('btnSon'), m = document.getElementById('btnMusique');
    if (!s) return;
    if (!pret()) { s.textContent = '🔇 Cliquer pour activer le son'; m.style.display = 'none'; return; }
    s.textContent = sonsActifs ? '🔊 Son' : '🔇 Son coupé';
    m.style.display = '';
    m.textContent = musiqueActive ? '🎵 Musique' : '🎵 Musique coupée';
    m.style.opacity = musiqueActive && sonsActifs ? 1 : 0.5;
  }

  function installerBoutons() {
    const zone = document.createElement('div');
    zone.className = 'sound-ctrl';
    zone.innerHTML = '<button id="btnSon" type="button"></button><button id="btnMusique" type="button"></button>';
    document.body.appendChild(zone);
    document.getElementById('btnSon').onclick = e => {
      e.stopPropagation();
      if (!pret()) return demarrer();
      sonsActifs = !sonsActifs;
      if (!sonsActifs) arreterMusique();
      majBoutons();
    };
    document.getElementById('btnMusique').onclick = e => {
      e.stopPropagation();
      musiqueActive = !musiqueActive;
      if (!musiqueActive) arreterMusique();
      majBoutons();
    };
    // N'importe quel clic sur la page active aussi le son
    document.addEventListener('click', demarrer);
    majBoutons();
  }

  return { installerBoutons, ...effets, lancerMusique, arreterMusique };
})();
