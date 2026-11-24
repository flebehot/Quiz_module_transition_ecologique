// =============================================================
//  Écran animateur (affiché au tableau) : QR code, questions,
//  réponses en direct, résultats et correction.
// =============================================================

import { TYPES, validateQuiz, pourParticipant, cleMot, correctesMatrice, estCorrect } from "./model.js";
import { Db, sessionCode } from "./firebase.js";
import { SESSION_MAX_AGE_H } from "./config.js";
import { el, toast } from "./dom.js";
import qrcode from "./vendor/qrcode.js";

const LS_LIVE = "quizapp:live";

export async function startLive(view, quiz, { onExit }) {
  const pb = validateQuiz(quiz);
  if (pb.length) {
    view.replaceChildren(el("div", { class: "card error" },
      el("p", {}, "Ce quiz n'est pas prêt pour une session :"),
      el("ul", {}, pb.map(m => el("li", {}, m))),
      el("a", { class: "btn", href: "#/quiz/" + encodeURIComponent(quiz.id) }, "Corriger le quiz")));
    return () => {};
  }

  const db = new Db();
  const live = {
    code: null, index: -1, phase: "accueil", showLive: false,
    participants: 0, answers: {}, mode: "", correction: null, pubQuestion: null,
    stops: { participants: null, answers: null }
  };
  const qs = quiz.questions;
  const counters = el("div", { class: "lv-counters" });
  const resultsBox = el("div", { class: "lv-results" });
  const joinUrl = () => new URL("r/?s=" + live.code, location.href.split("#")[0]).href;

  document.body.classList.add("live-mode");
  view.replaceChildren(el("p", { class: "muted pad" }, "Création de la session…"));

  // ---------- reprise éventuelle après un rechargement de page ----------
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_LIVE) || "null"); } catch (_) {}
  const resumable = saved && saved.quizId === quiz.id && Date.now() - saved.at < 12 * 3600e3;

  try {
    if (resumable && confirm(`Une session de ce quiz est en cours (code ${saved.code}). La reprendre ?\n\nAnnuler = démarrer une nouvelle session.`)) {
      const pub = await db.get(`sessions/${saved.code}/pub`);
      if (!pub) throw new Error("La session précédente n'existe plus.");
      live.code = saved.code; live.index = saved.index; live.phase = saved.phase;
      live.correction = pub.correction || null;
      live.pubQuestion = pub.question || null;
    } else {
      await purgeOldSessions(db);
      live.code = await newCode(db);
      await db.put(`index/${live.code}`, Date.now());
      await db.put(`sessions/${live.code}/pub`, {
        quiz: { titre: quiz.titre, nb: qs.length },
        etat: { phase: "attente", index: -1, qid: null }
      });
    }
  } catch (e) {
    document.body.classList.remove("live-mode");
    view.replaceChildren(el("div", { class: "card error" },
      el("p", {}, "Impossible de créer la session : " + e.message),
      el("p", { class: "muted small" }, "Vérifiez l'adresse de la base dans js/config.js et les règles de sécurité Firebase."),
      el("a", { class: "btn", href: "#/" }, "Retour")));
    return () => {};
  }

  const persist = () => {
    try { localStorage.setItem(LS_LIVE, JSON.stringify({ quizId: quiz.id, code: live.code, index: live.index, phase: live.phase, at: Date.now() })); } catch (_) {}
  };
  persist();

  live.stops.participants = db.watch(`sessions/${live.code}/participants`, (v) => {
    live.participants = v ? Object.keys(v).length : 0;
    updateCounters();
  }, { onMode: (m) => { live.mode = m; updateCounters(); } });

  if (live.index >= 0 && live.phase !== "fin") watchAnswers();

  // ---------- actions ----------
  async function act(fn) {
    try { await fn(); persist(); render(); }
    catch (e) { toast(e.message, "error"); }
  }

  function watchAnswers() {
    if (live.stops.answers) live.stops.answers();
    live.answers = {};
    const q = qs[live.index];
    live.stops.answers = db.watch(`sessions/${live.code}/reponses/${q.id}`, (v) => {
      live.answers = v || {};
      updateCounters();
      refreshResults();
    });
  }

  const openQuestion = (i) => act(async () => {
    const q = qs[i];
    const { question } = pourParticipant(q);
    live.index = i; live.phase = "question"; live.correction = null; live.showLive = false; live.pubQuestion = question;
    await db.patch(`sessions/${live.code}/pub`, { etat: { phase: "question", index: i, qid: q.id, nb: qs.length }, question, correction: null });
    watchAnswers();
  });
  const closeQuestion = () => act(async () => {
    live.phase = "fermee";
    await db.patch(`sessions/${live.code}/pub/etat`, { phase: "fermee" });
  });
  const reopen = () => act(async () => {
    live.phase = "question";
    await db.patch(`sessions/${live.code}/pub/etat`, { phase: "question" });
  });
  const reveal = () => act(async () => {
    const { correction } = pourParticipant(qs[live.index]);
    // la table de correspondance de l'appariement doit utiliser les identifiants publiés avec la question
    if (qs[live.index].type === "appariement") {
      const map = {};
      for (const p of qs[live.index].paires) {
        const d = ((live.pubQuestion || {}).droites || []).find(x => x.droite === p.droite);
        if (d) map[p.id] = d.id;
      }
      correction.map = map;
    }
    live.correction = correction;
    live.phase = "correction";
    await db.patch(`sessions/${live.code}/pub`, { etat: { phase: "correction", index: live.index, qid: qs[live.index].id, nb: qs.length }, correction });
  });
  const finish = () => act(async () => {
    live.phase = "fin";
    if (live.stops.answers) { live.stops.answers(); live.stops.answers = null; }
    await db.patch(`sessions/${live.code}/pub`, { etat: { phase: "fin", index: live.index, qid: null, nb: qs.length }, question: null, correction: null });
  });

  async function endSession() {
    if (!confirm("Fermer la session ? Toutes les réponses de cette session seront effacées.")) return;
    stopAll();
    try { await deleteSession(db, live.code); } catch (e) { toast("Effacement incomplet : " + e.message, "error"); }
    try { localStorage.removeItem(LS_LIVE); } catch (_) {}
    document.body.classList.remove("live-mode");
    onExit();
  }

  function stopAll() {
    for (const k in live.stops) if (live.stops[k]) { live.stops[k](); live.stops[k] = null; }
    document.removeEventListener("keydown", onKey);
  }

  function primary() {
    if (live.phase === "accueil" || live.phase === "attente") return openQuestion(0);
    if (live.phase === "question") return closeQuestion();
    const last = live.index >= qs.length - 1;
    const hasCorr = !!pourParticipant(qs[live.index]).correction;
    if (live.phase === "fermee" && hasCorr) return reveal();
    if (live.phase === "fermee" || live.phase === "correction") return last ? finish() : openQuestion(live.index + 1);
  }
  function onKey(e) {
    if (e.target.matches("input,textarea,select")) return;
    if (e.key === " " || e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); primary(); }
    if (e.key.toLowerCase() === "f") toggleFullscreen();
  }
  document.addEventListener("keydown", onKey);

  // ---------- affichage ----------
  function updateCounters() {
    const n = Object.keys(live.answers).length;
    const parts = [
      el("span", { class: "lv-pill" }, `👥 ${live.participants} connecté${live.participants > 1 ? "s" : ""}`)
    ];
    if (live.index >= 0 && live.phase !== "fin" && live.phase !== "accueil") parts.push(el("span", { class: "lv-pill strong" }, `✍ ${n} réponse${n > 1 ? "s" : ""}`));
    if (live.mode) parts.push(el("span", { class: "lv-pill dim", title: live.mode === "flux" ? "Mise à jour instantanée (flux SSE)" : "Mise à jour toutes les 1,5 s" }, live.mode === "flux" ? "● direct" : "● polling"));
    counters.replaceChildren(...parts);
  }
  function refreshResults() {
    if (live.index < 0 || live.phase === "fin") return;
    const visible = live.phase !== "question" || live.showLive;
    resultsBox.classList.toggle("masked", !visible);
    resultsBox.replaceChildren(visible
      ? renderResults(qs[live.index], live.answers, live.phase === "correction", live.pubQuestion)
      : el("p", { class: "lv-wait" }, "Les résultats s'afficheront à la clôture des réponses."));
  }

  function qrSvg(text, size) {
    const qr = qrcode(0, "M"); qr.addData(text); qr.make();
    const n = qr.getModuleCount(), m = 2;
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${n + 2 * m} ${n + 2 * m}`);
    svg.setAttribute("class", "lv-qr");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "QR code pour rejoindre la session");
    if (size) svg.style.width = svg.style.height = size;
    svg.setAttribute("shape-rendering", "crispEdges");
    const bg = document.createElementNS(ns, "rect"); bg.setAttribute("width", "100%"); bg.setAttribute("height", "100%"); bg.setAttribute("fill", "#fff");
    const path = document.createElementNS(ns, "path"); path.setAttribute("d", d); path.setAttribute("fill", "#000");
    svg.append(bg, path);
    return svg;
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.();
  }

  function render() {
    const url = joinUrl();
    const shortUrl = url.replace(/^https?:\/\//, "").replace(/\?s=.*$/, "");
    const top = el("header", { class: "lv-top" },
      el("div", { class: "lv-title" }, quiz.titre),
      counters,
      el("div", { class: "lv-join-mini" },
        live.phase !== "accueil" && live.phase !== "attente" ? qrSvg(url) : null,
        el("div", {}, el("div", { class: "lv-mini-url" }, shortUrl), el("div", { class: "lv-mini-code" }, "Code ", el("strong", {}, live.code)))),
      el("button", { class: "icon lv-icon", title: "Plein écran (touche F)", onclick: toggleFullscreen }, "⛶"),
      el("button", { class: "icon lv-icon", title: "Fermer la session", onclick: endSession }, "✕"));

    let main, controls;
    if (live.phase === "accueil" || live.phase === "attente") {
      main = el("section", { class: "lv-welcome" },
        el("div", { class: "lv-welcome-qr" }, qrSvg(url)),
        el("div", { class: "lv-welcome-text" },
          el("h1", {}, "Rejoignez le quiz"),
          el("p", { class: "lv-big" }, "Scannez le QR code avec votre téléphone"),
          el("p", {}, "ou ouvrez ", el("strong", {}, shortUrl)),
          el("p", {}, "et saisissez le code ", el("span", { class: "lv-code" }, live.code)),
          el("p", { class: "lv-muted" }, "Vos réponses sont anonymes.")));
      controls = [el("button", { class: "btn lv-primary", onclick: primary }, "Commencer le quiz →")];
    } else if (live.phase === "fin") {
      main = el("section", { class: "lv-end" },
        el("h1", {}, "Merci pour votre participation !"),
        el("p", { class: "lv-muted" }, `${qs.length} question${qs.length > 1 ? "s" : ""} · ${live.participants} participant${live.participants > 1 ? "s" : ""}`));
      controls = [
        el("button", { class: "btn ghost", onclick: () => openQuestion(live.index) }, "← Revenir à la dernière question"),
        el("button", { class: "btn lv-primary", onclick: endSession }, "Fermer la session et effacer les réponses")
      ];
    } else {
      const q = qs[live.index];
      const last = live.index >= qs.length - 1;
      const hasCorr = !!pourParticipant(q).correction;
      main = el("section", { class: "lv-question" },
        el("div", { class: "lv-qmeta" }, `Question ${live.index + 1} / ${qs.length} · ${TYPES[q.type].label}`,
          live.phase === "question" ? el("span", { class: "lv-state open" }, "Réponses ouvertes") : el("span", { class: "lv-state closed" }, "Réponses closes")),
        el("h1", { class: "lv-enonce" }, q.enonce),
        resultsBox,
        live.phase === "correction" && q.explication && q.explication.trim()
          ? el("div", { class: "lv-expl" }, el("strong", {}, "Explication : "), q.explication) : null);

      const next = last
        ? el("button", { class: "btn lv-primary", onclick: finish }, "Terminer le quiz")
        : el("button", { class: "btn lv-primary", onclick: () => openQuestion(live.index + 1) }, "Question suivante →");
      if (live.phase === "question") {
        controls = [
          el("button", { class: "btn ghost", onclick: () => { live.showLive = !live.showLive; render(); } }, live.showLive ? "Masquer les résultats" : "Afficher les résultats en direct"),
          el("button", { class: "btn lv-primary", onclick: closeQuestion }, "Clore les réponses")
        ];
      } else if (live.phase === "fermee") {
        controls = [
          el("button", { class: "btn ghost", onclick: reopen }, "Rouvrir les réponses"),
          hasCorr ? el("button", { class: "btn lv-primary", onclick: reveal }, "Révéler la bonne réponse") : next
        ];
      } else {
        controls = [next];
      }
      if (live.index > 0) controls.unshift(el("button", { class: "btn ghost", onclick: () => openQuestion(live.index - 1) }, "← Précédente"));
    }

    view.replaceChildren(el("div", { class: "lv" },
      top, el("main", { class: "lv-main" }, main),
      el("footer", { class: "lv-controls" }, el("span", { class: "lv-hint" }, "Espace / → : étape suivante · F : plein écran"), ...controls)));
    updateCounters();
    refreshResults();
  }

  render();
  return () => { stopAll(); document.body.classList.remove("live-mode"); };
}

// =============================================================
//  Résultats par type de question
// =============================================================
function bars(rows, total, { reveal = false } = {}) {
  const max = Math.max(1, ...rows.map(r => r.count));
  return el("div", { class: "lv-bars" }, rows.map(r => {
    const pct = total ? Math.round(100 * r.count / total) : 0;
    const cls = "lv-bar" + (reveal ? (r.correct ? " good" : (r.correct === false ? " bad" : "")) : "");
    return el("div", { class: cls },
      el("div", { class: "lv-bar-label" }, reveal && r.correct ? "✓ " : "", r.label),
      el("div", { class: "lv-bar-track" }, el("div", { class: "lv-bar-fill", style: { width: (100 * r.count / max) + "%" } })),
      el("div", { class: "lv-bar-val" }, el("strong", {}, pct + " %"), el("span", {}, ` (${r.count})`)));
  }));
}

export function renderResults(q, answers, reveal, pubQ) {
  const list = Object.values(answers || {});
  const n = list.length;
  if (!n) return el("p", { class: "lv-wait" }, "En attente des réponses…");

  switch (q.type) {
    case "choix": {
      const count = (id) => list.filter(a => [].concat(a).includes(id)).length;
      const hasCorr = q.options.some(o => o.correcte);
      const parts = [bars(q.options.map(o => ({ label: o.texte, count: count(o.id), correct: hasCorr ? !!o.correcte : undefined })), n, { reveal: reveal && hasCorr })];
      if (reveal && hasCorr && q.multiple) {
        const ok = q.options.filter(o => o.correcte).map(o => o.id).sort().join("|");
        const good = list.filter(a => [].concat(a).slice().sort().join("|") === ok).length;
        parts.push(el("p", { class: "lv-score" }, `${Math.round(100 * good / n)} % ont coché exactement les bonnes réponses`));
      }
      if (q.multiple) parts.push(el("p", { class: "lv-muted small" }, "Plusieurs réponses possibles : les pourcentages sont calculés sur le nombre de participants ayant répondu."));
      return el("div", {}, parts);
    }
    case "vraifaux": {
      const v = list.filter(a => a === true).length;
      return bars([
        { label: "Vrai", count: v, correct: q.reponse === true },
        { label: "Faux", count: n - v, correct: q.reponse === false }
      ], n, { reveal });
    }
    case "intrus":
      return bars(q.affirmations.map(o => ({ label: o.texte, count: list.filter(a => a === o.id).length, correct: o.id === q.intrus })), n, { reveal });

    case "echelle": {
      const rows = [];
      for (let s = q.max; s >= 1; s--) rows.push({ label: "★".repeat(s), count: list.filter(a => a === s).length });
      const avg = list.reduce((x, y) => x + Number(y || 0), 0) / n;
      return el("div", { class: "lv-scale" },
        el("div", { class: "lv-avg" },
          el("div", { class: "lv-avg-num" }, avg.toLocaleString("fr-FR", { maximumFractionDigits: 1 })),
          el("div", { class: "lv-avg-stars" }, el("span", { class: "on", style: { width: (100 * avg / q.max) + "%" } }, "★".repeat(q.max)), "★".repeat(q.max)),
          el("div", { class: "lv-muted" }, `moyenne sur ${q.max}`),
          el("div", { class: "lv-muted small" }, `1 = ${q.libelleMin} · ${q.max} = ${q.libelleMax}`)),
        bars(rows, n));
    }
    case "matrice": {
      const corr = correctesMatrice(q);
      const showCorr = reveal && corr;
      const head = el("tr", {}, el("th", {}), q.colonnes.map(c => el("th", {}, c.texte)));
      const rows = q.lignes.map(l => {
        const resp = list.filter(a => a && a[l.id]);
        const tot = resp.length;
        return el("tr", {}, el("th", { class: "row-h" }, l.texte), q.colonnes.map(c => {
          const k = resp.filter(a => [].concat(a[l.id]).includes(c.id)).length;
          const pct = tot ? Math.round(100 * k / tot) : 0;
          const good = showCorr && (corr[l.id] || []).includes(c.id);
          return el("td", { class: good ? "good" : (showCorr ? "dim" : ""),
            style: good ? {} : { background: `rgba(11,95,165,${(pct / 100) * (showCorr ? 0.35 : 0.85)})`, color: pct > 55 && !showCorr ? "#fff" : "inherit" } },
            good ? "✓ " : "", el("strong", {}, pct + " %"), el("span", {}, ` (${k})`));
        }));
      });
      const parts = [el("table", { class: "lv-matrix" }, el("thead", {}, head), el("tbody", {}, rows))];
      if (showCorr) {
        const ok = list.filter(a => estCorrect("matrice", { lignes: corr }, a)).length;
        parts.push(el("p", { class: "lv-score" }, `${Math.round(100 * ok / n)} % ont coché exactement la bonne combinaison`));
      }
      return el("div", {}, parts);
    }
    case "appariement": {
      const droites = (pubQ && pubQ.droites) || [];
      const label = (rid) => (droites.find(d => d.id === rid) || {}).droite || "?";
      const goodRid = (p) => (droites.find(d => d.droite === p.droite) || {}).id;
      const allGood = list.filter(a => q.paires.every(p => a && a[p.id] === goodRid(p))).length;
      return el("div", {},
        el("div", { class: "lv-match" }, q.paires.map(p => {
          const counts = {};
          let tot = 0;
          for (const a of list) { const v = a && a[p.id]; if (v) { counts[v] = (counts[v] || 0) + 1; tot++; } }
          const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3)
            .map(([rid, c]) => ({ label: label(rid), count: c, correct: rid === goodRid(p) }));
          return el("div", { class: "lv-match-item" },
            el("div", { class: "lv-match-left" }, p.gauche, reveal ? el("span", { class: "lv-match-answer" }, " → " + p.droite) : null),
            rows.length ? bars(rows, tot, { reveal }) : el("p", { class: "lv-muted small" }, "Aucune association"));
        })),
        reveal ? el("p", { class: "lv-score" }, `${Math.round(100 * allGood / n)} % ont trouvé toutes les associations`) : null);
    }
    case "nuage": return wordCloud(list);
  }
  return el("div");
}

function wordCloud(list) {
  const groups = new Map();
  for (const a of list) for (const w of [].concat(a || [])) {
    const k = cleMot(w);
    if (!k) continue;
    const g = groups.get(k) || { count: 0, forms: new Map() };
    g.count++;
    const f = String(w).trim();
    g.forms.set(f, (g.forms.get(f) || 0) + 1);
    groups.set(k, g);
  }
  const words = [...groups.values()].map(g => ({
    text: [...g.forms.entries()].sort((a, b) => b[1] - a[1])[0][0],
    count: g.count
  })).sort((a, b) => b.count - a.count).slice(0, 60);
  if (!words.length) return el("p", { class: "lv-wait" }, "En attente des mots…");
  const max = words[0].count, min = words[words.length - 1].count;
  const palette = ["#0b5fa5", "#1f8a4c", "#c25e00", "#7b3fa0", "#b0263a", "#127c8a", "#4a5a1f"];
  // le plus fréquent au centre, les autres alternés de part et d'autre
  const ordered = [];
  words.forEach((w, i) => { if (i % 2) ordered.push(w); else ordered.unshift(w); });
  return el("div", { class: "lv-cloud" }, ordered.map((w, i) => {
    const t = max === min ? 1 : (w.count - min) / (max - min);
    return el("span", { class: "lv-word", title: w.count + " fois",
      style: { fontSize: (1.1 + t * 3.2).toFixed(2) + "rem", color: palette[i % palette.length], fontWeight: t > 0.5 ? 800 : 600 } }, w.text);
  }));
}

// =============================================================
//  Gestion des sessions dans la base
// =============================================================
async function newCode(db) {
  for (let i = 0; i < 10; i++) {
    const c = sessionCode();
    if ((await db.get(`index/${c}`)) === null) return c;
  }
  throw new Error("Impossible de générer un code de session.");
}

async function deleteSession(db, code) {
  await Promise.all([
    db.del(`sessions/${code}/reponses`),
    db.del(`sessions/${code}/participants`),
    db.del(`sessions/${code}/pub`)
  ]);
  await db.del(`index/${code}`);
}

async function purgeOldSessions(db) {
  try {
    const idx = await db.get("index") || {};
    const limit = Date.now() - SESSION_MAX_AGE_H * 3600e3;
    await Promise.all(Object.entries(idx).filter(([, t]) => t < limit).map(([c]) => deleteSession(db, c)));
  } catch (_) { /* le nettoyage n'est pas bloquant */ }
}
