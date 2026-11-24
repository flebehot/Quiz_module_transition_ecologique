// =============================================================
//  Format des quiz (version 1)
//  Un quiz = un fichier JSON. Ce module définit sa structure,
//  la création de questions vierges et la validation.
// =============================================================

export const FORMAT = "quiz-formation/1";

// Limites de l'appariement (glisser-déposer sur téléphone)
export const MAX_PAIRES = 6;
export const MAX_LIB_PAIRE = 60;

/** Bonnes réponses d'une matrice, nettoyées ; null si question d'opinion. */
export function correctesMatrice(q) {
  const cols = new Set(q.colonnes.map(c => c.id));
  const out = {};
  for (const l of q.lignes) {
    const v = ((q.correctes || {})[l.id] || []).filter(id => cols.has(id));
    if (v.length) out[l.id] = q.multiple ? v : [v[0]];
  }
  return Object.keys(out).length ? out : null;
}

/** Mélange qui évite de laisser tous les éléments à leur place d'origine. */
export function melangeSansIdentite(arr) {
  const a = arr.slice();
  if (a.length < 2) return a;
  for (let t = 0; t < 20; t++) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    if (a.some((x, i) => x !== arr[i])) return a;
  }
  return a.reverse();
}

export const TYPES = {
  choix:       { label: "Choix multiple",            aide: "Une ou plusieurs bonnes réponses parmi une liste." },
  matrice:     { label: "Choix multiple matriciel",  aide: "Un tableau : pour chaque ligne, on coche une ou plusieurs colonnes." },
  echelle:     { label: "Échelle graduée (étoiles)", aide: "De 1 étoile (complètement en désaccord) à 5 étoiles (complètement d'accord)." },
  vraifaux:    { label: "Vrai ou faux",              aide: "Une affirmation, vraie ou fausse." },
  intrus:      { label: "Trouver l'intrus",          aide: "Plusieurs affirmations, une seule est fausse." },
  appariement: { label: "Appariement",               aide: "Relier chaque élément de gauche à son correspondant à droite." },
  nuage:       { label: "Nuage de mots",             aide: "Chacun saisit un ou plusieurs mots, affichés en nuage." }
};

export function uid(prefix = "") {
  return prefix + Math.random().toString(36).slice(2, 7) + Date.now().toString(36).slice(-4);
}

export function slugify(text) {
  return (text || "quiz")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 40) || "quiz";
}

const item = (texte = "") => ({ id: uid("o"), texte });

export function newQuiz(titre = "Nouveau quiz") {
  const now = new Date().toISOString();
  return {
    format: FORMAT,
    id: slugify(titre) + "-" + uid(),
    titre,
    description: "",
    creation: now,
    maj: now,
    questions: []
  };
}

export function newQuestion(type) {
  const base = { id: uid("q"), type, enonce: "", explication: "" };
  switch (type) {
    case "choix":
      return { ...base, multiple: false, options: [
        { ...item("Réponse A"), correcte: true },
        { ...item("Réponse B"), correcte: false },
        { ...item("Réponse C"), correcte: false }
      ] };
    case "matrice":
      return { ...base, multiple: false,
        lignes: [item("Ligne 1"), item("Ligne 2")],
        colonnes: [item("Colonne 1"), item("Colonne 2"), item("Colonne 3")],
        correctes: {} };
    case "echelle":
      return { ...base, max: 5,
        libelleMin: "Complètement en désaccord",
        libelleMax: "Complètement d'accord" };
    case "vraifaux":
      return { ...base, reponse: true };
    case "intrus": {
      const a = [item("Affirmation 1"), item("Affirmation 2"), item("Affirmation 3")];
      return { ...base, affirmations: a, intrus: a[2].id };
    }
    case "appariement":
      return { ...base, paires: [
        { id: uid("p"), gauche: "Élément 1", droite: "Correspondant 1" },
        { id: uid("p"), gauche: "Élément 2", droite: "Correspondant 2" },
        { id: uid("p"), gauche: "Élément 3", droite: "Correspondant 3" }
      ] };
    case "nuage":
      return { ...base, maxMots: 1 };
    default:
      throw new Error("Type de question inconnu : " + type);
  }
}

/** Copie profonde avec de nouveaux identifiants (pour dupliquer). */
export function cloneQuestion(q) {
  const c = JSON.parse(JSON.stringify(q));
  c.id = uid("q");
  return c;
}

export function cloneQuiz(quiz) {
  const c = JSON.parse(JSON.stringify(quiz));
  c.titre = quiz.titre + " (copie)";
  c.id = slugify(c.titre) + "-" + uid();
  c.creation = c.maj = new Date().toISOString();
  return c;
}

// -------------------------------------------------------------
//  Validation : renvoie une liste de messages (vide = valide)
// -------------------------------------------------------------
const vide = (s) => !s || !String(s).trim();

export function validateQuestion(q) {
  const e = [];
  if (vide(q.enonce)) e.push("L'énoncé est vide.");
  switch (q.type) {
    case "choix":
      if (q.options.length < 2) e.push("Il faut au moins 2 réponses.");
      if (q.options.some(o => vide(o.texte))) e.push("Une réponse est vide.");
      break;
    case "matrice": {
      if (q.lignes.length < 1) e.push("Il faut au moins 1 ligne.");
      if (q.colonnes.length < 2) e.push("Il faut au moins 2 colonnes.");
      if ([...q.lignes, ...q.colonnes].some(o => vide(o.texte))) e.push("Une ligne ou une colonne est vide.");
      const c = correctesMatrice(q);
      if (c) {
        const manque = q.lignes.filter(l => !c[l.id]).map(l => l.texte || "(sans titre)");
        if (manque.length) e.push("Bonnes réponses incomplètes : rien n'est coché pour « " + manque.join(" », « ") + " ».");
      }
      break;
    }
    case "echelle":
      if (!(q.max >= 3 && q.max <= 10)) e.push("L'échelle doit aller de 1 à 3 au minimum, 10 au maximum.");
      break;
    case "intrus":
      if (q.affirmations.length < 3) e.push("Il faut au moins 3 affirmations.");
      if (q.affirmations.some(o => vide(o.texte))) e.push("Une affirmation est vide.");
      if (!q.affirmations.some(o => o.id === q.intrus)) e.push("Indiquez quelle affirmation est l'intrus.");
      break;
    case "appariement":
      if (q.paires.length < 2) e.push("Il faut au moins 2 paires.");
      if (q.paires.length > MAX_PAIRES) e.push(`Pas plus de ${MAX_PAIRES} paires, pour rester lisible sur téléphone.`);
      if (q.paires.some(p => (p.gauche || "").length > MAX_LIB_PAIRE || (p.droite || "").length > MAX_LIB_PAIRE)) e.push(`Les libellés des paires doivent faire au plus ${MAX_LIB_PAIRE} caractères.`);
      if (q.paires.some(p => vide(p.gauche) || vide(p.droite))) e.push("Une paire est incomplète.");
      {
        const d = q.paires.map(p => p.droite.trim().toLowerCase());
        if (new Set(d).size !== d.length) e.push("Deux éléments de droite sont identiques.");
      }
      break;
    case "nuage":
      if (!(q.maxMots >= 1 && q.maxMots <= 5)) e.push("Le nombre de mots doit être entre 1 et 5.");
      break;
  }
  return e;
}

export function validateQuiz(quiz) {
  const e = [];
  if (vide(quiz.titre)) e.push("Le quiz n'a pas de titre.");
  if (!quiz.questions.length) e.push("Le quiz ne contient aucune question.");
  quiz.questions.forEach((q, i) => {
    for (const m of validateQuestion(q)) e.push(`Question ${i + 1} : ${m}`);
  });
  return e;
}

/** Contrôle un objet importé (fichier JSON) et le complète si besoin. */
export function normalizeQuiz(obj) {
  if (!obj || typeof obj !== "object") throw new Error("Le fichier ne contient pas de quiz.");
  if (obj.format && obj.format !== FORMAT) throw new Error("Format de quiz non reconnu : " + obj.format);
  if (!Array.isArray(obj.questions)) throw new Error("Le fichier ne contient pas de liste de questions.");
  for (const q of obj.questions) {
    if (!TYPES[q.type]) throw new Error("Type de question inconnu : " + q.type);
    q.id = q.id || uid("q");
    q.enonce = q.enonce || "";
    q.explication = q.explication || "";
  }
  const now = new Date().toISOString();
  return {
    format: FORMAT,
    id: obj.id || slugify(obj.titre) + "-" + uid(),
    titre: obj.titre || "Quiz importé",
    description: obj.description || "",
    creation: obj.creation || now,
    maj: obj.maj || now,
    questions: obj.questions
  };
}

// -------------------------------------------------------------
//  Session en direct
// -------------------------------------------------------------

/**
 * Sépare une question en deux :
 *  - "question" : ce que voient les téléphones pendant le vote (sans aucune bonne réponse)
 *  - "correction" : publiée seulement quand l'animateur révèle la réponse (null si question d'opinion)
 */
export function pourParticipant(q) {
  const base = { id: q.id, type: q.type, enonce: q.enonce };
  const expl = q.explication && q.explication.trim() ? q.explication.trim() : null;
  switch (q.type) {
    case "choix": {
      const ids = q.options.filter(o => o.correcte).map(o => o.id);
      return {
        question: { ...base, multiple: !!q.multiple, options: q.options.map(o => ({ id: o.id, texte: o.texte })) },
        correction: ids.length ? { ids, explication: expl } : (expl ? { ids: null, explication: expl } : null)
      };
    }
    case "vraifaux":
      return { question: base, correction: { valeur: q.reponse, explication: expl } };
    case "intrus":
      return {
        question: { ...base, affirmations: q.affirmations.map(o => ({ id: o.id, texte: o.texte })) },
        correction: { id: q.intrus, explication: expl }
      };
    case "appariement": {
      // les éléments de droite reçoivent des identifiants neutres pour ne pas trahir les paires
      const map = {};
      const droites = melangeSansIdentite(q.paires.map(p => { const rid = uid("d"); map[p.id] = rid; return { id: rid, droite: p.droite }; }));
      return {
        question: { ...base, paires: q.paires.map(p => ({ id: p.id, gauche: p.gauche })), droites },
        correction: { map, explication: expl }
      };
    }
    case "matrice": {
      const lignes = correctesMatrice(q);
      return {
        question: { ...base, multiple: !!q.multiple, lignes: q.lignes, colonnes: q.colonnes },
        correction: lignes ? { lignes, explication: expl } : (expl ? { explication: expl } : null)
      };
    }
    case "echelle":
      return { question: { ...base, max: q.max, libelleMin: q.libelleMin, libelleMax: q.libelleMax }, correction: expl ? { explication: expl } : null };
    case "nuage":
      return { question: { ...base, maxMots: q.maxMots }, correction: expl ? { explication: expl } : null };
  }
  return { question: base, correction: null };
}

/** true / false si la question a une bonne réponse, null sinon (opinion). */
export function estCorrect(type, correction, reponse) {
  if (!correction || reponse === null || reponse === undefined) return null;
  switch (type) {
    case "choix": {
      if (!correction.ids) return null;
      const a = [].concat(reponse).sort().join("|");
      return a === correction.ids.slice().sort().join("|");
    }
    case "vraifaux": return reponse === correction.valeur;
    case "intrus": return reponse === correction.id;
    case "matrice": {
      if (!correction.lignes) return null;
      const norm = (v) => [].concat(v || []).slice().sort().join("|");
      return Object.entries(correction.lignes).every(([l, cols]) => norm((reponse || {})[l]) === norm(cols));
    }
    case "appariement": {
      const m = correction.map || {};
      return Object.keys(m).every(k => reponse[k] === m[k]);
    }
  }
  return null;
}

/** Clé de regroupement d'un mot du nuage : minuscules, sans accents ni ponctuation. */
export function cleMot(mot) {
  return String(mot).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9' -]+/g, " ").replace(/\s+/g, " ").trim();
}
