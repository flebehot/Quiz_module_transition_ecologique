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
import { melangeSansIdentite, formatNombre } from "./model.js";

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
      body.append(el("p", { class: "p-hint" }, "Faites glisser les éléments de droite pour les placer en face de leur correspondant. Vous pouvez aussi toucher deux éléments pour les échanger."));
      const droites = q.droites || melangeSansIdentite(q.paires.map(p => ({ id: p.id, droite: p.droite })));
      const left = el("ol", { class: "p-dd-left" }, q.paires.map(p => el("li", { class: "p-dd-cell" }, el("span", {}, p.gauche))));
      const right = el("ol", { class: "p-dd-right", "aria-label": "Éléments à placer" }, droites.map(d =>
        el("li", { class: "p-dd-cell p-drag", "data-id": d.id, tabindex: "0", role: "button" },
          el("span", { class: "p-dd-grip", "aria-hidden": "true" }, "⠿"), el("span", {}, d.droite))));
      body.append(el("div", { class: "p-dd" }, left, right));
      makeSortable(right, change);
      getAnswer = () => {
        const order = [...right.children].map(li => li.dataset.id);
        const a = {};
        q.paires.forEach((p, i) => { a[p.id] = order[i]; });
        return a;
      };
      isComplete = () => true;
      break;
    }

    case "curseur": {
      let touched = false;
      const mid = q.min + Math.round((q.max - q.min) / 2 / q.pas) * q.pas;
      const out = el("output", { class: "p-slider-val" }, "?");
      const range = el("input", { type: "range", class: "p-slider", min: q.min, max: q.max, step: q.pas, value: mid,
        "aria-label": q.enonce,
        oninput: () => { touched = true; range.classList.add("touched"); out.textContent = formatNombre(Number(range.value), q.pas, q.unite); change(); } });
      const nudge = (d) => {
        const v = Math.min(q.max, Math.max(q.min, Number(range.value) + d * q.pas));
        range.value = v; range.dispatchEvent(new Event("input"));
      };
      body.append(
        el("p", { class: "p-hint" }, "Faites glisser le curseur, puis ajustez avec − et +."),
        out,
        range,
        el("div", { class: "p-slider-scale" }, el("span", {}, formatNombre(q.min, q.pas, q.unite)), el("span", {}, formatNombre(q.max, q.pas, q.unite))),
        el("div", { class: "p-slider-nudge" },
          el("button", { type: "button", class: "p-nudge", onclick: () => nudge(-1), "aria-label": "Diminuer" }, "−"),
          el("button", { type: "button", class: "p-nudge", onclick: () => nudge(1), "aria-label": "Augmenter" }, "+")));
      getAnswer = () => touched ? Number(range.value) : null;
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

// =============================================================
//  Liste réordonnable au doigt ou à la souris (sans bibliothèque)
//  - glisser un élément verticalement pour le déplacer
//  - ou toucher un élément puis un autre pour les échanger
//  - clavier : flèches haut / bas sur l'élément sélectionné
// =============================================================
function makeSortable(list, onChange) {
  let drag = null, selected = null;
  const items = () => [...list.children];
  const select = (li) => {
    if (selected) selected.classList.remove("selected");
    selected = li;
    if (li) li.classList.add("selected");
  };
  const swap = (a, b) => {
    const marker = document.createComment("");
    a.replaceWith(marker); b.replaceWith(a); marker.replaceWith(b);
  };
  const flash = (...lis) => lis.forEach(li => { li.classList.remove("moved"); void li.offsetWidth; li.classList.add("moved"); });

  list.addEventListener("pointerdown", (e) => {
    const li = e.target.closest(".p-drag");
    if (!li || e.button > 0) return;
    e.preventDefault();
    li.setPointerCapture(e.pointerId);
    const r = li.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
    drag = { li, startY: e.clientY, offset: 0, moved: false, step: r.height + gap };
  });

  list.addEventListener("pointermove", (e) => {
    if (!drag) return;
    let dy = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(dy) < 8) return;
    if (!drag.moved) { drag.moved = true; drag.li.classList.add("dragging"); select(null); }
    const all = items();
    const idx = all.indexOf(drag.li);
    const target = Math.max(0, Math.min(all.length - 1, idx + Math.round(dy / drag.step)));
    if (target !== idx) {
      list.insertBefore(drag.li, target > idx ? all[target].nextSibling : all[target]);
      drag.startY += (target - idx) * drag.step;
      dy = e.clientY - drag.startY;
    }
    drag.li.style.transform = `translateY(${dy}px)`;
  });

  const end = () => {
    if (!drag) return;
    const { li, moved } = drag;
    drag = null;
    li.style.transform = "";
    li.classList.remove("dragging");
    if (moved) { flash(li); onChange(); return; }
    // simple toucher : sélection puis échange
    if (!selected) select(li);
    else if (selected === li) select(null);
    else { const other = selected; select(null); swap(other, li); flash(other, li); onChange(); }
  };
  list.addEventListener("pointerup", end);
  list.addEventListener("pointercancel", end);

  list.addEventListener("keydown", (e) => {
    const li = e.target.closest(".p-drag");
    if (!li) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(selected === li ? null : li); return; }
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const sib = e.key === "ArrowUp" ? li.previousElementSibling : li.nextElementSibling;
    if (!sib) return;
    if (e.key === "ArrowUp") list.insertBefore(li, sib); else list.insertBefore(sib, li);
    li.focus(); flash(li); onChange();
  });
}
