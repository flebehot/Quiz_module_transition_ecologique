// Petit utilitaire de création d'éléments (le texte est toujours inséré
// comme texte, jamais comme HTML : pas de risque d'injection).
export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (k === "value") n.value = v;
    else if (k === "checked") n.checked = !!v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let toastTimer;
export function toast(msg, kind = "info") {
  let t = document.getElementById("toast");
  if (!t) { t = el("div", { id: "toast", role: "status", "aria-live": "polite" }); document.body.append(t); }
  t.className = "toast show " + kind;
  t.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), kind === "error" ? 6000 : 2800);
}
