// =============================================================
//  Affichage d'une question côté participant (téléphone).
//  Utilisé par l'aperçu de l'éditeur, puis par l'interface de réponse.
//  renderQuestion(q) -> { node, getAnswer(), isComplete() }
//
//  Format des réponses :
//   choix       -> [idOption, ...]
//   matrice     -> { idLigne: [idColonne, ...] }
//   echelle     -> nombre (1..max)
//   vraifaux    -> true | false
//   intrus      -> idAffirmation
//   appariement -> { idPaire(gauche): idPaire(droite choisie) }
//   nuage       -> ["mot", ...]
// =============================================================

import { el, shuffle } from "./dom.js";

let groupSeq = 0;

export function renderQuestion(q, { onChange = () => {} } = {}) {
  const name = "g" + (++groupSeq);
  const change = () => onChange();
  const body = el("div", { class: "p-body" });
  let getAnswer = () => null;
  let isComplete = () => getAnswer() !== null;

  switch (q.type) {
    case "choix": {
      const type = q.multiple ? "checkbox" : "radio";
      const inputs = q.options.map(o => {
        const i = el("input", { type, name, value: o.id, onchange: change });
        body.append(el("label", { class: "p-choice" }, i, el("span", {}, o.texte)));
        return i;
      });
      if (q.multiple) body.prepend(el("p", { class: "p-hint" }, "Plusieurs réponses possibles"));
      getAnswer = () => { const v = inputs.filter(i => i.checked).map(i => i.value); return v.length ? v : null; };
      break;
    }

    case "matrice": {
      const type = q.multiple ? "checkbox" : "radio";
      const rows = q.lignes.map((l, li) => {
        const inputs = q.colonnes.map(c => el("input", { type, name: name + "-" + li, value: c.id, onchange: change }));
        body.append(el("fieldset", { class: "p-row" },
          el("legend", {}, l.texte),
          el("div", { class: "p-chips" }, q.colonnes.map((c, ci) => el("label", { class: "p-chip" }, inputs[ci], el("span", {}, c.texte))))
        ));
        return { id: l.id, inputs };
      });
      if (q.multiple) body.prepend(el("p", { class: "p-hint" }, "Plusieurs choix possibles par ligne"));
      getAnswer = () => {
        const a = {};
        for (const r of rows) { const v = r.inputs.filter(i => i.checked).map(i => i.value); if (v.length) a[r.id] = v; }
        return Object.keys(a).length ? a : null;
      };
      isComplete = () => { const a = getAnswer(); return !!a && rows.every(r => a[r.id]); };
      break;
    }

    case "echelle": {
      let value = null;
      const stars = [];
      const paint = () => stars.forEach((s, i) => {
        s.classList.toggle("on", value !== null && i < value);
        s.setAttribute("aria-checked", String(value === i + 1));
      });
      const group = el("div", { class: "p-stars", role: "radiogroup", "aria-label": q.enonce });
      for (let n = 1; n <= q.max; n++) {
        const s = el("button", { type: "button", class: "p-star", role: "radio", "aria-label": n + " sur " + q.max,
          onclick: () => { value = n; paint(); change(); } }, "★");
        stars.push(s); group.append(s);
      }
      body.append(group, el("div", { class: "p-scale" }, el("span", {}, "1 · " + q.libelleMin), el("span", {}, q.max + " · " + q.libelleMax)));
      paint();
      getAnswer = () => value;
      break;
    }

    case "vraifaux": {
      let value = null;
      const bV = el("button", { type: "button", class: "p-big", onclick: () => set(true) }, "Vrai");
      const bF = el("button", { type: "button", class: "p-big", onclick: () => set(false) }, "Faux");
      function set(v) { value = v; bV.classList.toggle("on", v === true); bF.classList.toggle("on", v === false); change(); }
      body.append(el("div", { class: "p-tf" }, bV, bF));
      getAnswer = () => value;
      break;
    }

    case "intrus": {
      body.append(el("p", { class: "p-hint" }, "Une seule affirmation est fausse : laquelle ?"));
      const inputs = shuffle(q.affirmations).map(o => {
        const i = el("input", { type: "radio", name, value: o.id, onchange: change });
        body.append(el("label", { class: "p-choice" }, i, el("span", {}, o.texte)));
        return i;
      });
      getAnswer = () => { const i = inputs.find(x => x.checked); return i ? i.value : null; };
      break;
    }

    case "appariement": {
      body.append(el("p", { class: "p-hint" }, "Associez chaque élément à son correspondant."));
      const droite = shuffle(q.droites || q.paires.map(p => ({ id: p.id, droite: p.droite })));
      const selects = q.paires.map(p => {
        const s = el("select", { onchange: change, "aria-label": p.gauche },
          el("option", { value: "" }, "— choisir —"),
          droite.map(d => el("option", { value: d.id }, d.droite)));
        body.append(el("label", { class: "p-match" }, el("span", { class: "p-left" }, p.gauche), s));
        return { id: p.id, s };
      });
      getAnswer = () => {
        const a = {};
        for (const x of selects) if (x.s.value) a[x.id] = x.s.value;
        return Object.keys(a).length ? a : null;
      };
      isComplete = () => selects.every(x => x.s.value);
      break;
    }

    case "nuage": {
      const n = q.maxMots || 1;
      body.append(el("p", { class: "p-hint" }, n > 1 ? `Jusqu'à ${n} mots, un par case.` : "Un mot ou une courte expression."));
      const inputs = [];
      for (let i = 0; i < n; i++) {
        const inp = el("input", { type: "text", class: "p-word", maxlength: "30", autocomplete: "off", autocapitalize: "none",
          placeholder: n > 1 ? `Mot ${i + 1}` : "Votre mot", oninput: change });
        inputs.push(inp); body.append(inp);
      }
      getAnswer = () => { const v = inputs.map(i => i.value.trim()).filter(Boolean); return v.length ? v : null; };
      break;
    }
  }

  const node = el("div", { class: "p-question" },
    el("h2", { class: "p-enonce" }, q.enonce || "(énoncé vide)"),
    body
  );
  return { node, getAnswer, isComplete };
}
