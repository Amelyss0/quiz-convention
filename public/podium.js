// =====================================================================
//  Podium animé : 3e → (clic) → 2e → (clic) → 1er + confettis + 4e/5e
// =====================================================================
const Podium = (() => {
  const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Un trophée dessiné en SVG. "metal" choisit les couleurs, "taille" la largeur en pixels.
  const METAUX = {
    bronze: ['#f0b27a', '#b5651d', '#7a3e0e'],
    argent: ['#ffffff', '#c0c6cf', '#7d8591'],
    or:     ['#fff3a0', '#f6c12a', '#b07a00']
  };
  function trophee(metal, taille) {
    const [clair, moyen, fonce] = METAUX[metal];
    return `<svg class="trophy" width="${taille}" height="${taille}" viewBox="0 0 100 100" aria-hidden="true">
      <defs><linearGradient id="g-${metal}" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="${clair}"/><stop offset=".55" stop-color="${moyen}"/><stop offset="1" stop-color="${fonce}"/>
      </linearGradient></defs>
      <path d="M28 16 H72 V40 C72 56 62 64 50 64 C38 64 28 56 28 40 Z" fill="url(#g-${metal})"/>
      <path d="M28 22 H16 C16 38 22 46 32 48" fill="none" stroke="${moyen}" stroke-width="6" stroke-linecap="round"/>
      <path d="M72 22 H84 C84 38 78 46 68 48" fill="none" stroke="${moyen}" stroke-width="6" stroke-linecap="round"/>
      <rect x="45" y="63" width="10" height="14" fill="${moyen}"/>
      <rect x="32" y="76" width="36" height="9" rx="2" fill="url(#g-${metal})"/>
      <rect x="26" y="85" width="48" height="8" rx="2" fill="${fonce}"/>
      <path d="M38 22 C38 34 41 42 46 46" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="4" stroke-linecap="round"/>
    </svg>`;
  }

  // Les 3 marches : ordre d'affichage gauche → droite = 2e, 1er, 3e
  const PLACES = {
    1: { metal: 'or',     taille: 150, classe: 'p1' },
    2: { metal: 'argent', taille: 115, classe: 'p2' },
    3: { metal: 'bronze', taille: 85,  classe: 'p3' }
  };

  function marche(rang, joueur) {
    const P = PLACES[rang];
    const contenu = joueur
      ? `${trophee(P.metal, P.taille)}<div class="pod-name">${esc(joueur.name)}</div><div class="pod-score">${joueur.score} pts</div>`
      : '<div class="pod-name pod-vide">—</div>';
    return `<div class="pod-col ${P.classe}" id="pod${rang}">
      <div class="pod-top">${contenu}</div>
      <div class="pod-pillar"><span>${rang}</span></div>
    </div>`;
  }

  // ---------- Confettis ----------
  function confettis(duree = 6000) {
    const c = document.createElement('canvas');
    c.className = 'confetti';
    document.body.appendChild(c);
    const ctx = c.getContext('2d');
    const resize = () => { c.width = innerWidth; c.height = innerHeight; };
    resize(); addEventListener('resize', resize);
    const COULEURS = ['#e5384b', '#2f6bff', '#ffc61a', '#1fb47a', '#ffffff', '#ff8ad8'];
    const morceaux = Array.from({ length: 220 }, () => ({
      x: Math.random() * c.width, y: -20 - Math.random() * c.height,
      l: 6 + Math.random() * 8, h: 10 + Math.random() * 10,
      vy: 2 + Math.random() * 3.5, vx: -1 + Math.random() * 2,
      a: Math.random() * Math.PI, va: -0.1 + Math.random() * 0.2,
      couleur: COULEURS[Math.floor(Math.random() * COULEURS.length)]
    }));
    const debut = performance.now();
    (function frame(t) {
      const fin = t - debut > duree;
      ctx.clearRect(0, 0, c.width, c.height);
      let visibles = 0;
      morceaux.forEach(m => {
        m.y += m.vy; m.x += m.vx + Math.sin((t / 400) + m.a); m.a += m.va;
        if (m.y > c.height + 20) { if (fin) return; m.y = -20; m.x = Math.random() * c.width; }
        visibles++;
        ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.a);
        ctx.fillStyle = m.couleur; ctx.fillRect(-m.l / 2, -m.h / 2, m.l, m.h * Math.abs(Math.cos(m.a)));
        ctx.restore();
      });
      if (visibles > 0) requestAnimationFrame(frame);
      else { c.remove(); removeEventListener('resize', resize); }
    })(debut);
  }

  // ---------- Déroulé ----------
  function afficher(zone, top) {
    if (!top.length) { zone.innerHTML = '<h1>Partie terminée</h1><p class="hint">Aucun joueur.</p>'; return; }
    zone.innerHTML = `
      <h1 class="pod-title">Podium</h1>
      <div class="podium">${marche(2, top[1])}${marche(1, top[0])}${marche(3, top[2])}</div>
      <ol class="pod-rest" id="podRest" start="4">${top.slice(3, 5).map(p => `<li>${esc(p.name)} – ${p.score} pts</li>`).join('')}</ol>
      <button class="go" id="podNext" style="visibility:hidden"></button>`;

    // Étapes de révélation (on saute les places vides s'il y a moins de 3 joueurs)
    const etapes = [3, 2, 1].filter(r => top[r - 1]);
    let i = 0;
    const btn = document.getElementById('podNext');
    const LIBELLE = { 2: 'Révéler le 2e', 1: 'Révéler le 1er' };

    function suivant() {
      const rang = etapes[i++];
      document.getElementById('pod' + rang).classList.add('show');
      if (rang === 1) {
        Sons.podium();
        confettis();
        setTimeout(() => document.getElementById('podRest').classList.add('show'), 900);
      } else {
        Sons.place();
      }
      if (i < etapes.length) { btn.textContent = LIBELLE[etapes[i]]; btn.style.visibility = ''; }
      else btn.style.visibility = 'hidden';
    }

    btn.onclick = suivant;
    // Les places vides restent visibles (pilier sans nom) pour garder la forme du podium
    [1, 2, 3].filter(r => !top[r - 1]).forEach(r => document.getElementById('pod' + r).classList.add('show'));
    setTimeout(suivant, 600);   // le 3e (ou le premier rang existant) apparaît tout seul
  }

  return { afficher };
})();
