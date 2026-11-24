// =============================================================
//  Interface participant (téléphone) : rejoindre, répondre, voir la correction
// =============================================================

import { Db, participantId } from "./firebase.js";
import { renderQuestion } from "./participant.js";
import { estCorrect } from "./model.js";
import { el } from "./dom.js";

const app = document.getElementById("app");
const net = document.getElementById("rNet");
const db = new Db();

const params = new URLSearchParams(location.search);
const code = (params.get("s") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

if (!code) askCode(); else join(code);

// ---------- saisie du code ----------
function askCode(message) {
  const input = el("input", { type: "text", class: "r-code-input", maxlength: "8", autocomplete: "off", autocapitalize: "characters",
    placeholder: "CODE", "aria-label": "Code de la session", inputmode: "text" });
  const go = () => {
    const c = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (c.length >= 4) location.search = "?s=" + c;
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  app.replaceChildren(el("div", { class: "r-card r-center" },
    el("h1", {}, "Rejoindre un quiz"),
    message ? el("p", { class: "r-error" }, message) : null,
    el("p", { class: "muted" }, "Saisissez le code affiché à l'écran."),
    input,
    el("button", { class: "p-send", onclick: go }, "Rejoindre")));
  input.focus();
}

// ---------- session ----------
async function join(code) {
  let pub;
  try { pub = await db.get(`sessions/${code}/pub`); }
  catch (e) { return askCode("Connexion impossible : " + e.message); }
  if (!pub) return askCode(`Aucune session en cours avec le code ${code}.`);

  const pid = participantId(code);
  const LS = "quizapp:rep:" + code;
  let mine = {};
  try { mine = JSON.parse(localStorage.getItem(LS) || "{}"); } catch (_) {}
  const remember = () => { try { localStorage.setItem(LS, JSON.stringify(mine)); } catch (_) {} };

  try { await db.put(`sessions/${code}/participants/${pid}`, Date.now()); } catch (_) {}

  let key = "";          // phase + question affichées (évite de redessiner pendant la saisie)
  let editing = false;   // le participant modifie une réponse déjà envoyée
  let current = pub;

  const update = (p) => {
    current = p;
    net.textContent = "";
    if (!p) { key = "fin-session"; return show(el("div", { class: "r-card r-center" }, el("div", { class: "r-emoji" }, "👋"), el("h1", {}, "La session est terminée"), el("p", { class: "muted" }, "Merci pour votre participation !"))); }
    document.getElementById("rTitle").textContent = (p.quiz && p.quiz.titre) || "Quiz";
    const e = p.etat || {};
    const k = [e.phase, e.qid, editing].join("|");
    if (k === key) return;
    key = k;
    render(p);
  };

  db.watch(`sessions/${code}/pub`, update, {
    onError: () => { net.textContent = "⚠ connexion instable…"; }
  });

  function show(...nodes) { app.replaceChildren(...nodes); window.scrollTo(0, 0); }

  function render(p) {
    const e = p.etat || {};
    const q = p.question;
    const num = e.index >= 0 ? `Question ${e.index + 1}/${e.nb || (p.quiz && p.quiz.nb) || "?"}` : "";

    if (e.phase === "attente" || !e.phase) {
      return show(el("div", { class: "r-card r-center" },
        el("div", { class: "r-emoji" }, "✅"),
        el("h1", {}, "Vous êtes connecté"),
        el("p", { class: "muted" }, "Le quiz va commencer. Gardez cette page ouverte : les questions s'afficheront automatiquement.")));
    }
    if (e.phase === "fin") {
      return show(el("div", { class: "r-card r-center" },
        el("div", { class: "r-emoji" }, "🎉"),
        el("h1", {}, "Quiz terminé"),
        el("p", { class: "muted" }, "Merci pour votre participation !")));
    }
    if (!q) return show(el("p", { class: "r-center muted" }, "En attente de la question…"));

    if (e.phase === "question") {
      const already = mine[q.id] !== undefined;
      if (already && !editing) {
        return show(el("div", { class: "r-card r-center" },
          el("p", { class: "p-top" }, num),
          el("div", { class: "r-emoji" }, "📨"),
          el("h1", {}, "Réponse envoyée"),
          el("p", { class: "muted" }, "Regardez l'écran. Vous pouvez modifier votre réponse tant que la question est ouverte."),
          el("button", { class: "btn ghost", onclick: () => { editing = true; update(current); } }, "Modifier ma réponse")));
      }
      const status = el("p", { class: "r-error", role: "alert" });
      const r = renderQuestion(q, { onChange: () => { send.disabled = !r.isComplete(); } });
      const send = el("button", { class: "p-send", disabled: true, onclick: async () => {
        send.disabled = true; send.textContent = "Envoi…"; status.textContent = "";
        try {
          await db.put(`sessions/${code}/reponses/${q.id}/${pid}`, r.getAnswer());
          mine[q.id] = r.getAnswer(); remember();
          editing = false; key = ""; update(current);
        } catch (err) {
          send.disabled = false; send.textContent = "Envoyer ma réponse";
          status.textContent = /règles|401|403/.test(err.message) ? "Les réponses à cette question sont closes." : "Envoi impossible, réessayez. (" + err.message + ")";
        }
      } }, "Envoyer ma réponse");
      return show(el("div", { class: "r-q" }, el("p", { class: "p-top" }, num), r.node, status, send));
    }

    if (e.phase === "fermee") {
      return show(el("div", { class: "r-card r-center" },
        el("p", { class: "p-top" }, num),
        el("div", { class: "r-emoji" }, "⏸"),
        el("h1", {}, "Réponses closes"),
        el("p", { class: "muted" }, mine[q.id] !== undefined ? "Votre réponse a bien été prise en compte. Regardez l'écran !" : "Vous n'avez pas répondu à cette question. Regardez l'écran !")));
    }

    if (e.phase === "correction") {
      const c = p.correction;
      const a = mine[q.id];
      const ok = estCorrect(q.type, c, a === undefined ? null : a);
      const parts = [el("p", { class: "p-top" }, num), el("h2", { class: "p-enonce" }, q.enonce)];
      if (ok === true) parts.push(el("div", { class: "r-verdict good" }, "✓ Bonne réponse !"));
      else if (ok === false) parts.push(el("div", { class: "r-verdict bad" }, "✗ Ce n'était pas la bonne réponse"));
      else if (a === undefined && c && hasAnswer(q.type, c)) parts.push(el("div", { class: "r-verdict neutral" }, "Vous n'avez pas répondu"));
      const sol = solution(q, c);
      if (sol) parts.push(el("div", { class: "r-solution" }, el("strong", {}, "La bonne réponse : "), sol));
      if (c && c.explication) parts.push(el("div", { class: "r-expl" }, c.explication));
      if (!sol) parts.push(el("p", { class: "muted" }, "Merci ! Les résultats du groupe sont à l'écran."));
      return show(el("div", { class: "r-card" }, parts));
    }
  }
}

function hasAnswer(type, c) { return ["vraifaux", "intrus", "appariement"].includes(type) || (type === "choix" && c.ids); }

function solution(q, c) {
  if (!c) return null;
  switch (q.type) {
    case "choix":
      if (!c.ids) return null;
      return el("ul", {}, q.options.filter(o => c.ids.includes(o.id)).map(o => el("li", {}, o.texte)));
    case "vraifaux": return c.valeur ? "Vrai" : "Faux";
    case "intrus": {
      const o = q.affirmations.find(x => x.id === c.id);
      return o ? el("span", {}, "l'intrus était « ", o.texte, " »") : null;
    }
    case "appariement":
      return el("ul", {}, q.paires.map(p => {
        const d = (q.droites || []).find(x => x.id === (c.map || {})[p.id]);
        return el("li", {}, p.gauche, " → ", el("strong", {}, d ? d.droite : "?"));
      }));
  }
  return null;
}
