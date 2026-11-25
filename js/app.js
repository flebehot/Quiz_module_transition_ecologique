// =============================================================
//  Application formateur : liste des quiz, éditeur, réglages
//  Navigation par l'adresse :  #/  ·  #/quiz/<id>  ·  #/reglages
// =============================================================

import { TYPES, newQuiz, newQuestion, cloneQuestion, cloneQuiz, validateQuestion, validateQuiz, uid, MAX_PAIRES, MAX_LIB_PAIRE, TYPES_NOTABLES, POINTS_CHOIX, POINTS_DEFAUT, formatNombre } from "./model.js";
import { getSettings, saveSettings, makeStore, GitHubStore, LocalStore, exportQuizFile, importQuizFiles } from "./storage.js";
import { renderQuestion } from "./participant.js";
import { el, toast } from "./dom.js";
import { startLive } from "./animer.js";

let stopLive = null;

const view = document.getElementById("view");
const state = { store: makeStore(), quiz: null, dirty: false };

window.addEventListener("hashchange", route);
window.addEventListener("beforeunload", (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ""; } });
document.getElementById("storeLabel").textContent = state.store.label;

function confirmLeave() {
  return !state.dirty || confirm("Des modifications ne sont pas enregistrées. Quitter quand même ?");
}

let lastHash = location.hash;
queueMicrotask(route);
async function route() {
  if (state.dirty && location.hash !== lastHash && !confirmLeave()) { history.replaceState(null, "", lastHash); return; }
  lastHash = location.hash;
  state.dirty = false;
  const h = location.hash.replace(/^#\/?/, "");
  window.scrollTo(0, 0);
  if (stopLive) { stopLive(); stopLive = null; }
  if (h.startsWith("animer/")) return showLive(decodeURIComponent(h.slice(7)));
  if (h.startsWith("quiz/")) return showEditor(decodeURIComponent(h.slice(5)));
  if (h === "reglages") return showSettings();
  return showList();
}

function busy(msg = "Chargement…") { view.replaceChildren(el("p", { class: "muted pad" }, msg)); }
function fmtDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }); } catch (_) { return iso; }
}

// =============================================================
//  LISTE DES QUIZ
// =============================================================
async function showList() {
  busy();
  let list;
  try { list = await state.store.list(); }
  catch (e) {
    view.replaceChildren(el("div", { class: "card error" },
      el("p", {}, "Impossible de lire les quiz : " + e.message),
      el("a", { href: "#/reglages", class: "btn" }, "Vérifier les réglages")));
    return;
  }

  const create = async () => {
    const titre = prompt("Titre du nouveau quiz :", "Nouveau quiz");
    if (titre === null) return;
    const q = newQuiz(titre.trim() || "Nouveau quiz");
    try { await state.store.save(q); location.hash = "#/quiz/" + encodeURIComponent(q.id); }
    catch (e) { toast(e.message, "error"); }
  };

  const doImport = async () => {
    const { ok, errors } = await importQuizFiles();
    for (const q of ok) {
      if (list.some(x => x.id === q.id) && !confirm(`Un quiz « ${q.titre} » avec le même identifiant existe déjà. Le remplacer ?`)) continue;
      try { await state.store.save(q); } catch (e) { errors.push(q.titre + " : " + e.message); }
    }
    if (errors.length) toast("Import incomplet : " + errors.join(" · "), "error");
    else if (ok.length) toast(ok.length + " quiz importé(s).");
    showList();
  };

  const rows = list.map(item => el("li", { class: "quiz-row" },
    el("a", { class: "quiz-main", href: "#/quiz/" + encodeURIComponent(item.id) },
      el("strong", {}, item.titre),
      el("span", { class: "muted" }, `${item.nb} question${item.nb > 1 ? "s" : ""} · modifié le ${fmtDate(item.maj)}`)),
    el("div", { class: "quiz-actions" },
      el("a", { class: "btn small", href: "#/animer/" + encodeURIComponent(item.id), title: "Lancer une session en direct" }, "▶ Animer"),
      el("button", { class: "btn ghost", title: "Dupliquer", onclick: async () => {
        try { const c = cloneQuiz(await state.store.load(item.id)); await state.store.save(c); toast("Quiz dupliqué."); showList(); }
        catch (e) { toast(e.message, "error"); }
      } }, "Dupliquer"),
      el("button", { class: "btn ghost", title: "Télécharger le fichier JSON", onclick: async () => {
        try { exportQuizFile(await state.store.load(item.id)); } catch (e) { toast(e.message, "error"); }
      } }, "Exporter"),
      el("button", { class: "btn ghost danger", onclick: async () => {
        if (!confirm(`Supprimer définitivement « ${item.titre} » ?`)) return;
        try { await state.store.remove(item.id); toast("Quiz supprimé."); showList(); }
        catch (e) { toast(e.message, "error"); }
      } }, "Supprimer")
    )
  ));

  view.replaceChildren(
    el("div", { class: "page-head" },
      el("h1", {}, "Mes quiz"),
      el("div", { class: "row" },
        el("button", { class: "btn ghost", onclick: doImport }, "Importer un fichier"),
        el("button", { class: "btn", onclick: create }, "+ Nouveau quiz"))),
    list.length
      ? el("ul", { class: "quiz-list card" }, rows)
      : el("div", { class: "card empty" },
          el("p", {}, "Aucun quiz pour l'instant."),
          el("p", { class: "muted" }, state.store.mode === "local"
            ? "Les quiz sont enregistrés dans ce navigateur. Pour les sauvegarder durablement sur GitHub, passez par les réglages."
            : "Créez votre premier quiz : il sera enregistré dans votre dépôt GitHub."))
  );
}

// =============================================================
//  SESSION EN DIRECT
// =============================================================
async function showLive(id) {
  busy();
  let quiz;
  try { quiz = await state.store.load(id); }
  catch (e) { view.replaceChildren(el("div", { class: "card error" }, el("p", {}, e.message), el("a", { href: "#/", class: "btn" }, "Retour"))); return; }
  stopLive = await startLive(view, quiz, { onExit: () => { stopLive = null; location.hash = "#/"; } });
}

// =============================================================
//  ÉDITEUR
// =============================================================
async function showEditor(id) {
  busy();
  try { state.quiz = await state.store.load(id); }
  catch (e) {
    view.replaceChildren(el("div", { class: "card error" }, el("p", {}, e.message), el("a", { href: "#/", class: "btn" }, "Retour à la liste")));
    return;
  }
  state.dirty = false;
  renderEditor();
}

function markDirty() {
  state.dirty = true;
  const b = document.getElementById("saveBtn");
  if (b) { b.disabled = false; b.textContent = "Enregistrer"; }
  const s = document.getElementById("saveState");
  if (s) s.textContent = "Modifications non enregistrées";
}

async function save() {
  const quiz = state.quiz;
  quiz.maj = new Date().toISOString();
  const b = document.getElementById("saveBtn");
  b.disabled = true; b.textContent = "Enregistrement…";
  try {
    await state.store.save(quiz);
    state.dirty = false;
    b.textContent = "Enregistré";
    document.getElementById("saveState").textContent = "Enregistré le " + fmtDate(quiz.maj);
    const pb = validateQuiz(quiz);
    toast(pb.length ? `Enregistré, avec ${pb.length} point(s) à corriger avant de l'utiliser.` : "Quiz enregistré.");
    renderIssues();
  } catch (e) {
    b.disabled = false; b.textContent = "Enregistrer";
    toast(e.message, "error");
  }
}

// raccourci Ctrl+S / Cmd+S
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && state.quiz && location.hash.startsWith("#/quiz/")) {
    e.preventDefault();
    if (state.dirty) save();
  }
});

function renderIssues() {
  const box = document.getElementById("issues");
  if (!box) return;
  const pb = validateQuiz(state.quiz);
  box.replaceChildren(...(pb.length
    ? [el("details", { class: "issues" }, el("summary", {}, `${pb.length} point(s) à corriger avant d'utiliser ce quiz en session`), el("ul", {}, pb.map(m => el("li", {}, m))))]
    : [el("p", { class: "ok-line" }, "✓ Quiz complet, prêt à être utilisé.")]));
}

function renderEditor(focusQuestionId) {
  const quiz = state.quiz;
  const scroll = window.scrollY;

  const header = el("div", { class: "editor-bar" },
    el("a", { href: "#/", class: "btn ghost" }, "← Mes quiz"),
    el("span", { id: "saveState", class: "muted" }, state.dirty ? "Modifications non enregistrées" : "Enregistré le " + fmtDate(quiz.maj)),
    el("div", { class: "row" },
      el("button", { class: "btn ghost", onclick: () => exportQuizFile(quiz) }, "Exporter"),
      el("button", { class: "btn ghost", onclick: () => preview(0), disabled: !quiz.questions.length }, "Aperçu participant"),
      el("button", { id: "saveBtn", class: "btn", onclick: save, disabled: !state.dirty }, state.dirty ? "Enregistrer" : "Enregistré"),
      el("button", { class: "btn ghost", title: "Lancer une session en direct", onclick: () => {
        if (state.dirty) return toast("Enregistrez le quiz avant de lancer la session.", "error");
        location.hash = "#/animer/" + encodeURIComponent(quiz.id);
      } }, "▶ Animer"))
  );

  const meta = el("section", { class: "card" },
    el("label", { class: "field" }, el("span", {}, "Titre du quiz"),
      el("input", { type: "text", class: "big", value: quiz.titre, maxlength: "120", oninput: (e) => { quiz.titre = e.target.value; markDirty(); renderIssuesDebounced(); } })),
    el("label", { class: "field" }, el("span", {}, "Description (facultatif, pour vous)"),
      el("textarea", { rows: "2", oninput: (e) => { quiz.description = e.target.value; markDirty(); } }, quiz.description)),
    el("div", { class: "classement-opt" + (quiz.classement ? " on" : "") },
      toggle("Classement des participants", !!quiz.classement, (v) => { quiz.classement = v; markDirty(); renderEditor(); }),
      el("p", { class: "muted small" }, quiz.classement
        ? "Les participants saisissent un pseudo. Chaque question à bonne réponse rapporte des points (réglables ci-dessous) ; chacun voit ses points après la correction, et le classement s'affiche à la fin du quiz."
        : "Désactivé : les participants restent anonymes, sans points ni classement.")),
    el("div", { id: "issues" })
  );

  const questions = quiz.questions.map((q, i) => questionCard(q, i));

  const adder = el("section", { class: "card adder" },
    el("h2", {}, "Ajouter une question"),
    el("div", { class: "type-grid" }, Object.entries(TYPES).map(([type, t]) =>
      el("button", { class: "type-btn", onclick: () => {
        const q = newQuestion(type);
        quiz.questions.push(q);
        markDirty();
        renderEditor(q.id);
      } }, el("strong", {}, t.label), el("span", {}, t.aide))))
  );

  view.replaceChildren(header, meta, ...questions, adder);
  renderIssues();

  if (focusQuestionId) {
    const card = document.getElementById("card-" + focusQuestionId);
    if (card) { card.scrollIntoView({ behavior: "smooth", block: "center" }); const t = card.querySelector("textarea"); if (t) t.focus({ preventScroll: true }); }
  } else {
    window.scrollTo(0, scroll);
  }
}

let issuesTimer;
function renderIssuesDebounced() { clearTimeout(issuesTimer); issuesTimer = setTimeout(renderIssues, 400); }

function questionCard(q, index) {
  const quiz = state.quiz;
  const n = quiz.questions.length;
  const problems = el("ul", { class: "q-problems" });
  const refreshProblems = () => { problems.replaceChildren(...validateQuestion(q).map(m => el("li", {}, m))); renderIssuesDebounced(); };
  const touch = () => { markDirty(); refreshProblems(); };
  const restructure = () => { markDirty(); renderEditor(); };

  const move = (d) => { const a = quiz.questions; [a[index], a[index + d]] = [a[index + d], a[index]]; restructure(); };

  const card = el("section", { class: "card question", id: "card-" + q.id },
    el("div", { class: "q-head" },
      el("span", { class: "q-num" }, index + 1),
      el("span", { class: "q-type" }, TYPES[q.type].label),
      el("div", { class: "q-tools" },
        el("button", { class: "icon", title: "Monter", disabled: index === 0, onclick: () => move(-1) }, "↑"),
        el("button", { class: "icon", title: "Descendre", disabled: index === n - 1, onclick: () => move(1) }, "↓"),
        el("button", { class: "icon", title: "Aperçu participant", onclick: () => preview(index) }, "👁"),
        el("button", { class: "icon", title: "Dupliquer", onclick: () => { quiz.questions.splice(index + 1, 0, cloneQuestion(q)); restructure(); } }, "⧉"),
        el("button", { class: "icon danger", title: "Supprimer", onclick: () => {
          if (confirm("Supprimer cette question ?")) { quiz.questions.splice(index, 1); restructure(); }
        } }, "✕"))),
    el("label", { class: "field" }, el("span", {}, "Énoncé"),
      el("textarea", { rows: "2", placeholder: "Votre question…", oninput: (e) => { q.enonce = e.target.value; touch(); } }, q.enonce)),
    typeEditor(q, touch, restructure),
    pointsRow(q, touch),
    el("details", { class: "field explication", open: !!q.explication },
      el("summary", {}, "Explication affichée à la correction (facultatif)"),
      el("textarea", { rows: "2", placeholder: "Pourquoi c'est la bonne réponse…", oninput: (e) => { q.explication = e.target.value; markDirty(); } }, q.explication)),
    problems
  );
  refreshProblems();
  return card;
}

// ---------- points de la question ----------
function pointsRow(q, touch) {
  if (!state.quiz.classement || !TYPES_NOTABLES.includes(q.type)) return null;
  if (typeof q.points !== "number") q.points = POINTS_DEFAUT;
  const hint = {
    choix: "Sans effet si aucune bonne réponse n'est cochée.",
    matrice: "Sans effet si aucune bonne réponse n'est cochée dans la grille.",
    curseur: "Valeur exacte : le double. Sinon, une part des points selon l'écart, jusqu'à 0 pour l'écart maximal."
  }[q.type];
  return el("div", { class: "points-row" },
    el("label", { class: "field inline" }, el("span", {}, "🏆 Points pour une bonne réponse"),
      el("select", { onchange: (e) => { q.points = Number(e.target.value); touch(); } },
        POINTS_CHOIX.map(v => el("option", { value: v, selected: q.points === v }, v)))),
    hint ? el("span", { class: "muted small" }, hint) : null);
}

// ---------- éditeurs par type ----------
function textInput(obj, key, touch, placeholder = "", max = 200) {
  return el("input", { type: "text", value: obj[key], placeholder, maxlength: String(max),
    oninput: (e) => { obj[key] = e.target.value; touch(); },
    onblur: touch.blur || null });
}
/** Pour les libellés affichés ailleurs (grille des bonnes réponses) : redessine à la sortie du champ. */
function restructureSoon(touch, restructure) {
  let changed = false;
  const f = () => { changed = true; touch(); };
  f.blur = () => { if (changed) restructure(); };
  return f;
}
function removeBtn(arr, i, min, restructure, what = "cet élément") {
  return el("button", { class: "icon danger", title: "Retirer " + what, disabled: arr.length <= min, onclick: () => { arr.splice(i, 1); restructure(); } }, "✕");
}
function toggle(label, checked, onchange) {
  return el("label", { class: "toggle" }, el("input", { type: "checkbox", checked, onchange: (e) => onchange(e.target.checked) }), el("span", {}, label));
}

function typeEditor(q, touch, restructure) {
  switch (q.type) {
    case "choix": {
      const kind = q.multiple ? "checkbox" : "radio";
      const name = "c-" + q.id;
      return el("div", { class: "type-editor" },
        toggle("Plusieurs réponses possibles", q.multiple, (v) => {
          q.multiple = v;
          if (!v) { let seen = false; q.options.forEach(o => { if (o.correcte && !seen) seen = true; else o.correcte = false; }); }
          restructure();
        }),
        el("p", { class: "muted small" }, "Cochez la ou les bonnes réponses. Aucune case cochée = question d'opinion, sans correction."),
        el("ul", { class: "opts" }, q.options.map((o, i) => el("li", {},
          el("input", { type: kind, name, checked: o.correcte, title: "Bonne réponse", onclick: (e) => {
            if (q.multiple) o.correcte = e.target.checked;
            else if (o.correcte) { o.correcte = false; e.target.checked = false; } // un second clic décoche
            else { q.options.forEach(x => x.correcte = (x === o)); }
            touch();
          } }),
          textInput(o, "texte", touch, "Réponse " + (i + 1)),
          removeBtn(q.options, i, 2, restructure, "cette réponse")))),
        el("button", { class: "btn ghost small", disabled: q.options.length >= 10, onclick: () => { q.options.push({ id: uid("o"), texte: "", correcte: false }); restructure(); } }, "+ Ajouter une réponse")
      );
    }

    case "matrice": {
      q.correctes = q.correctes || {};
      q.multiple = true; // une matrice accepte toujours plusieurs choix par ligne (et par colonne)
      const cell = (l, c) => {
        const on = (q.correctes[l.id] || []).includes(c.id);
        return el("td", {}, el("input", { type: "checkbox", checked: on, "aria-label": `${l.texte} / ${c.texte}`,
          onchange: (e) => {
            const cur = q.correctes[l.id] || [];
            q.correctes[l.id] = e.target.checked ? [...cur.filter(x => x !== c.id), c.id] : cur.filter(x => x !== c.id);
            if (!q.correctes[l.id].length) delete q.correctes[l.id];
            touch();
          } }));
      };
      return el("div", { class: "type-editor" },
        el("div", { class: "two-cols" },
          el("div", {},
            el("h3", {}, "Lignes"),
            el("ul", { class: "opts" }, q.lignes.map((o, i) => el("li", {}, textInput(o, "texte", restructureSoon(touch, restructure), "Ligne " + (i + 1)), removeBtn(q.lignes, i, 1, restructure)))),
            el("button", { class: "btn ghost small", disabled: q.lignes.length >= 10, onclick: () => { q.lignes.push({ id: uid("o"), texte: "" }); restructure(); } }, "+ Ligne")),
          el("div", {},
            el("h3", {}, "Colonnes"),
            el("ul", { class: "opts" }, q.colonnes.map((o, i) => el("li", {}, textInput(o, "texte", restructureSoon(touch, restructure), "Colonne " + (i + 1)), removeBtn(q.colonnes, i, 2, restructure)))),
            el("button", { class: "btn ghost small", disabled: q.colonnes.length >= 6, onclick: () => { q.colonnes.push({ id: uid("o"), texte: "" }); restructure(); } }, "+ Colonne"))),
        el("h3", {}, "Bonnes réponses (facultatif)"),
        el("p", { class: "muted small" }, "Cochez, pour chaque ligne, toutes les colonnes attendues (une ou plusieurs ; une même colonne peut valoir pour plusieurs lignes). Rien de coché = question d'opinion, sans correction."),
        el("div", { class: "mx-wrap" }, el("table", { class: "mx-grid" },
          el("thead", {}, el("tr", {}, el("th", {}), q.colonnes.map(c => el("th", {}, c.texte || "…")))),
          el("tbody", {}, q.lignes.map(l => el("tr", {}, el("th", { class: "row-h" }, l.texte || "…"), q.colonnes.map(c => cell(l, c))))))),
        Object.keys(q.correctes).length
          ? el("button", { class: "btn ghost small", onclick: () => { q.correctes = {}; restructure(); } }, "Effacer les bonnes réponses")
          : null
      );
    }

    case "echelle":
      return el("div", { class: "type-editor" },
        el("label", { class: "field inline" }, el("span", {}, "Nombre d'étoiles"),
          el("select", { onchange: (e) => { q.max = Number(e.target.value); touch(); } },
            [3, 4, 5, 6, 7, 10].map(v => el("option", { value: v, selected: q.max === v }, v)))),
        el("div", { class: "two-cols" },
          el("label", { class: "field" }, el("span", {}, "Libellé de 1 étoile"), textInput(q, "libelleMin", touch)),
          el("label", { class: "field" }, el("span", {}, `Libellé de ${q.max} étoiles`), textInput(q, "libelleMax", touch)))
      );

    case "vraifaux": {
      const name = "vf-" + q.id;
      return el("div", { class: "type-editor" },
        el("p", { class: "small" }, "La bonne réponse est :"),
        el("div", { class: "row" },
          el("label", { class: "toggle" }, el("input", { type: "radio", name, checked: q.reponse === true, onchange: () => { q.reponse = true; touch(); } }), el("span", {}, "Vrai")),
          el("label", { class: "toggle" }, el("input", { type: "radio", name, checked: q.reponse === false, onchange: () => { q.reponse = false; touch(); } }), el("span", {}, "Faux")))
      );
    }

    case "intrus": {
      const name = "in-" + q.id;
      return el("div", { class: "type-editor" },
        el("p", { class: "muted small" }, "Sélectionnez l'affirmation fausse (l'intrus). L'ordre sera mélangé pour les participants."),
        el("ul", { class: "opts" }, q.affirmations.map((o, i) => el("li", {},
          el("input", { type: "radio", name, checked: q.intrus === o.id, title: "C'est l'intrus", onchange: () => { q.intrus = o.id; touch(); } }),
          textInput(o, "texte", touch, "Affirmation " + (i + 1)),
          removeBtn(q.affirmations, i, 3, restructure, "cette affirmation")))),
        el("button", { class: "btn ghost small", disabled: q.affirmations.length >= 8, onclick: () => { q.affirmations.push({ id: uid("o"), texte: "" }); restructure(); } }, "+ Ajouter une affirmation")
      );
    }

    case "appariement":
      return el("div", { class: "type-editor" },
        el("p", { class: "muted small" }, `Saisissez les paires correctes (${MAX_PAIRES} au maximum, libellés courts : ${MAX_LIB_PAIRE} caractères). Sur le téléphone, la colonne de droite est mélangée et le participant fait glisser chaque élément en face du bon correspondant.`),
        el("ul", { class: "opts pairs" }, q.paires.map((p, i) => el("li", {},
          textInput(p, "gauche", touch, "Élément " + (i + 1), MAX_LIB_PAIRE),
          el("span", { class: "arrow" }, "↔"),
          textInput(p, "droite", touch, "Correspondant " + (i + 1), MAX_LIB_PAIRE),
          removeBtn(q.paires, i, 2, restructure, "cette paire")))),
        el("button", { class: "btn ghost small", disabled: q.paires.length >= MAX_PAIRES, onclick: () => { q.paires.push({ id: uid("p"), gauche: "", droite: "" }); restructure(); } },
          q.paires.length >= MAX_PAIRES ? `Maximum atteint (${MAX_PAIRES} paires)` : "+ Ajouter une paire")
      );

    case "curseur": {
      const num = (key, label, attrs = {}) => el("label", { class: "field" }, el("span", {}, label),
        el("input", { type: "number", value: q[key], step: "any", inputmode: "decimal", ...attrs,
          oninput: (e) => { q[key] = e.target.value === "" ? NaN : Number(e.target.value); touch(); refresh(); } }));
      const info = el("p", { class: "muted small" });
      const refresh = () => {
        const ok = [q.min, q.max, q.pas, q.valeur].every(x => typeof x === "number" && isFinite(x)) && q.max > q.min && q.pas > 0;
        if (!ok) { info.textContent = ""; return; }
        const n = Math.round((q.max - q.min) / q.pas) + 1;
        const ecartMax = Math.max(q.valeur - q.min, q.max - q.valeur);
        info.textContent = `${n} positions possibles, de ${formatNombre(q.min, q.pas, q.unite)} à ${formatNombre(q.max, q.pas, q.unite)}. ` +
          `Bonne réponse : ${formatNombre(q.valeur, q.pas, q.unite)}` +
          (state.quiz.classement ? ` · 0 point à ${formatNombre(ecartMax, q.pas, q.unite)} d'écart ou plus.` : ".");
      };
      refresh();
      return el("div", { class: "type-editor" },
        el("div", { class: "four-cols" },
          num("min", "Minimum"),
          num("max", "Maximum"),
          num("pas", "Pas (précision)", { min: "0" }),
          el("label", { class: "field" }, el("span", {}, "Unité (facultatif)"),
            el("input", { type: "text", value: q.unite, maxlength: "12", placeholder: "%, €, km…", oninput: (e) => { q.unite = e.target.value.trim(); touch(); refresh(); } }))),
        el("div", { class: "two-cols" }, num("valeur", "Bonne valeur à trouver"), el("div")),
        info);
    }

    case "nuage":
      return el("div", { class: "type-editor" },
        el("label", { class: "field inline" }, el("span", {}, "Mots par participant"),
          el("select", { onchange: (e) => { q.maxMots = Number(e.target.value); touch(); } },
            [1, 2, 3, 4, 5].map(v => el("option", { value: v, selected: q.maxMots === v }, v)))),
        el("p", { class: "muted small" }, "Les mots identiques sont regroupés (sans tenir compte des majuscules ni des accents).")
      );
  }
  return el("div");
}

// =============================================================
//  APERÇU PARTICIPANT (cadre téléphone)
// =============================================================
function preview(start) {
  const qs = state.quiz.questions;
  if (!qs.length) return;
  let i = start;
  const screen = el("div", { class: "phone-screen" });
  const counter = el("span", { class: "muted" });
  const prev = el("button", { class: "btn ghost", onclick: () => go(-1) }, "← Précédente");
  const next = el("button", { class: "btn ghost", onclick: () => go(1) }, "Suivante →");
  const answerBox = el("p", { class: "answer-debug" });

  function draw() {
    const r = renderQuestion(qs[i], { onChange: () => {
      const a = r.getAnswer();
      answerBox.textContent = a === null ? "Aucune réponse saisie" : (r.isComplete() ? "✓ Réponse complète : le bouton d'envoi est actif" : "Réponse incomplète : le bouton d'envoi reste grisé");
      send.disabled = !r.isComplete();
    } });
    const send = el("button", { class: "p-send", disabled: true, onclick: () => toast("Aperçu : la réponse serait envoyée.") }, "Envoyer ma réponse");
    send.disabled = !r.isComplete();
    screen.replaceChildren(el("div", { class: "p-top" }, `Question ${i + 1}/${qs.length}`), r.node, send);
    answerBox.textContent = qs[i].type === "appariement" ? "Ordre initial : le participant peut envoyer tel quel ou réorganiser" : "Aucune réponse saisie";
    counter.textContent = `${i + 1} / ${qs.length}`;
    prev.disabled = i === 0; next.disabled = i === qs.length - 1;
  }
  function go(d) { i = Math.max(0, Math.min(qs.length - 1, i + d)); draw(); }

  const overlay = el("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": "Aperçu participant",
    onclick: (e) => { if (e.target === overlay) close(); } },
    el("div", { class: "modal-box" },
      el("div", { class: "modal-head" }, el("strong", {}, "Aperçu sur téléphone"), counter, el("button", { class: "icon", onclick: close, title: "Fermer" }, "✕")),
      el("div", { class: "phone" }, screen),
      answerBox,
      el("div", { class: "row center" }, prev, next)));
  function close() { overlay.remove(); document.removeEventListener("keydown", onKey); }
  function onKey(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
  draw();
}

// =============================================================
//  RÉGLAGES DU STOCKAGE
// =============================================================
function showSettings() {
  const s = getSettings();
  const g = s.github;
  const result = el("div", { class: "test-result" });

  const f = (key, label, attrs = {}) => el("label", { class: "field" }, el("span", {}, label),
    el("input", { type: "text", value: g[key], autocomplete: "off", spellcheck: "false", oninput: (e) => { g[key] = e.target.value.trim(); }, ...attrs }));

  const ghBlock = el("div", { class: "gh-block" + (s.mode === "github" ? "" : " hidden") },
    el("div", { class: "two-cols" },
      f("owner", "Votre identifiant GitHub", { placeholder: "ex. : jdupont" }),
      f("repo", "Dépôt PRIVÉ des quiz", { placeholder: "ex. : mes-quiz" })),
    el("div", { class: "two-cols" },
      f("branch", "Branche"),
      f("dossier", "Dossier dans le dépôt")),
    f("token", "Jeton d'accès personnel (fine-grained token)", { type: "password", placeholder: "github_pat_…" }),
    el("details", { class: "help" },
      el("summary", {}, "Comment créer le dépôt privé et le jeton ?"),
      el("ol", {},
        el("li", {}, "Sur GitHub, créez un nouveau dépôt ", el("strong", {}, "privé"), " (par exemple « mes-quiz ») en cochant « Add a README file »."),
        el("li", {}, "Allez dans votre profil → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token."),
        el("li", {}, "Repository access : « Only select repositories » → choisissez uniquement le dépôt des quiz."),
        el("li", {}, "Permissions → Repository permissions → Contents : « Read and write »."),
        el("li", {}, "Choisissez une date d'expiration, générez le jeton et collez-le ici.")),
      el("p", { class: "muted small" }, "Le jeton reste uniquement dans ce navigateur. Il ne donne accès qu'au dépôt des quiz.")),
    el("div", { class: "row" },
      el("button", { class: "btn ghost", onclick: async () => {
        result.className = "test-result"; result.textContent = "Test en cours…";
        try {
          const r = await new GitHubStore(g).test();
          result.className = "test-result " + (r.ok ? (r.warn ? "warn" : "ok") : "ko");
          result.textContent = r.ok ? (r.warn || "✓ Connexion réussie, écriture autorisée.") : r.warn;
        } catch (e) { result.className = "test-result ko"; result.textContent = e.message; }
      } }, "Tester la connexion"),
      el("button", { class: "btn ghost", onclick: async () => {
        const local = new LocalStore();
        const items = await local.list();
        if (!items.length) return toast("Aucun quiz dans ce navigateur.");
        if (!confirm(`Copier les ${items.length} quiz de ce navigateur vers GitHub ?`)) return;
        const gh = new GitHubStore(g);
        let ok = 0; const errs = [];
        for (const it of items) { try { await gh.save(await local.load(it.id)); ok++; } catch (e) { errs.push(it.titre + " : " + e.message); } }
        toast(errs.length ? `${ok} copié(s), ${errs.length} erreur(s) : ${errs[0]}` : `${ok} quiz copié(s) vers GitHub.`, errs.length ? "error" : "info");
      } }, "Copier les quiz du navigateur vers GitHub")),
    result
  );

  const modeRadio = (value, title, desc) => el("label", { class: "mode" },
    el("input", { type: "radio", name: "mode", value, checked: s.mode === value, onchange: () => {
      s.mode = value; ghBlock.classList.toggle("hidden", value !== "github");
    } }),
    el("span", {}, el("strong", {}, title), el("span", { class: "muted small" }, desc)));

  view.replaceChildren(
    el("div", { class: "page-head" }, el("h1", {}, "Réglages du stockage")),
    el("section", { class: "card" },
      el("h2", {}, "Où enregistrer les quiz ?"),
      modeRadio("local", "Dans ce navigateur", "Aucune configuration. Pratique pour essayer, mais les quiz restent sur ce poste et disparaissent si l'on vide le navigateur. Pensez à exporter."),
      modeRadio("github", "Dans un dépôt GitHub privé (recommandé)", "Sauvegarde durable, historique des versions, accessible depuis n'importe quel poste. Les bonnes réponses restent invisibles des participants."),
      ghBlock),
    el("div", { class: "row end" },
      el("a", { href: "#/", class: "btn ghost" }, "Annuler"),
      el("button", { class: "btn", onclick: () => {
        if (s.mode === "github" && !(g.owner && g.repo && g.token)) return toast("Renseignez l'identifiant, le dépôt et le jeton.", "error");
        saveSettings(s);
        state.store = makeStore(s);
        document.getElementById("storeLabel").textContent = state.store.label;
        toast("Réglages enregistrés.");
        location.hash = "#/";
      } }, "Enregistrer les réglages"))
  );
}
