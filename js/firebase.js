// =============================================================
//  Accès à Firebase Realtime Database par l'API REST (HTTPS simple)
//  - lecture / écriture : fetch
//  - suivi en direct : flux SSE (EventSource) si le réseau le permet,
//    sinon interrogation régulière (polling). Aucun WebSocket.
// =============================================================

import { FIREBASE_URL, POLL_MS } from "./config.js";

export class Db {
  constructor(base = FIREBASE_URL) { this.base = base.replace(/\/+$/, ""); }

  url(path, query = "") { return `${this.base}/${path.replace(/^\/+/, "")}.json${query}`; }

  async req(method, path, body, query = "") {
    let res;
    try {
      res = await fetch(this.url(path, query), {
        method, cache: "no-store",
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (e) {
      throw new Error("Connexion à la base impossible (réseau ?)");
    }
    if (!res.ok) {
      const why = res.status === 401 || res.status === 403 ? " : accès refusé par les règles de sécurité" : "";
      throw new Error(`Base Firebase : erreur ${res.status}${why}`);
    }
    return res.json();
  }
  async get(path, query) { return fromDb(await this.req("GET", path, undefined, query)); }
  put(path, value) { return this.req("PUT", path, value); }
  patch(path, value) { return this.req("PATCH", path, value); }
  del(path) { return this.req("DELETE", path); }

  /**
   * Suit les changements d'un emplacement.
   * cb(valeur) est appelé à chaque changement (valeur complète de l'emplacement).
   * onMode(mode) informe du canal utilisé : "flux" ou "polling".
   * Renvoie une fonction pour arrêter le suivi.
   */
  watch(path, cb, { onMode = () => {}, onError = () => {}, sse = true } = {}) {
    let stopped = false, es = null, timer = null, value = null, lastJson = "";

    const emit = (raw) => {
      const v = fromDb(raw);
      const j = JSON.stringify(v);
      if (j === lastJson) return;
      lastJson = j;
      cb(v);
    };

    const startPolling = () => {
      if (stopped) return;
      onMode("polling");
      let busy = false;
      const tick = async () => {
        if (stopped || busy) return;
        busy = true;
        try { emit(await this.get(path)); }
        catch (e) { onError(e); }
        finally { busy = false; }
      };
      tick();
      timer = setInterval(tick, POLL_MS);
    };

    const startSse = () => {
      let errors = 0, gotData = false;
      try { es = new EventSource(this.url(path)); }
      catch (_) { return startPolling(); }
      const fail = () => {
        errors++;
        // le flux ne passe pas (ou plus) : on bascule définitivement sur le polling
        if (!gotData || errors >= 3) {
          try { es.close(); } catch (_) {}
          es = null;
          this.sseBroken = true; // les suivis suivants passeront directement en polling
          if (!stopped && !timer) startPolling();
        }
      };
      es.addEventListener("put", (ev) => {
        gotData = true; errors = 0;
        const { path: p, data } = JSON.parse(ev.data);
        value = setAt(value, p, data);
        emit(value);
      });
      es.addEventListener("patch", (ev) => {
        gotData = true; errors = 0;
        const { path: p, data } = JSON.parse(ev.data);
        for (const [k, v] of Object.entries(data || {})) value = setAt(value, joinPath(p, k), v);
        emit(value);
      });
      es.addEventListener("cancel", fail);
      es.onerror = fail;
      onMode("flux");
      // garde-fou : sans donnée après 6 s, on passe au polling
      setTimeout(() => { if (!gotData && es && !stopped) fail(); }, 6000);
    };

    if (sse && !this.sseBroken && "EventSource" in window) startSse(); else startPolling();

    return () => { stopped = true; if (es) es.close(); if (timer) clearInterval(timer); };
  }
}

/**
 * Firebase stocke les listes comme des objets { "0": …, "1": … } et peut les renvoyer
 * sous l'une ou l'autre forme : on reconvertit systématiquement en tableaux.
 */
export function fromDb(v) {
  if (Array.isArray(v)) return v.filter(x => x !== null && x !== undefined).map(fromDb);
  if (v && typeof v === "object") {
    const ks = Object.keys(v);
    if (ks.length && ks.every(k => /^\d+$/.test(k))) {
      return ks.map(Number).sort((a, b) => a - b).map(k => fromDb(v[k]));
    }
    const o = {};
    for (const k of ks) o[k] = fromDb(v[k]);
    return o;
  }
  return v;
}

function joinPath(a, b) { return (a.replace(/\/+$/, "") + "/" + b).replace(/\/+/g, "/"); }

/** Applique une valeur à un chemin "/a/b" dans un objet (copie), null = suppression. */
function setAt(root, path, data) {
  const keys = path.split("/").filter(Boolean);
  if (!keys.length) return data;
  const copy = (root && typeof root === "object") ? { ...root } : {};
  let cur = copy;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    cur[k] = (cur[k] && typeof cur[k] === "object") ? { ...cur[k] } : {};
    cur = cur[k];
  }
  const last = keys[keys.length - 1];
  if (data === null) delete cur[last]; else cur[last] = data;
  return copy;
}

/** Code de session lisible (sans caractères ambigus 0/O, 1/I/L). */
export function sessionCode(len = 5) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  const r = crypto.getRandomValues(new Uint32Array(len));
  for (const x of r) s += chars[x % chars.length];
  return s;
}

/** Identifiant anonyme d'un téléphone pour une session (stable si la page est rechargée). */
export function participantId(code) {
  const key = "quizapp:pid:" + code;
  try {
    let id = localStorage.getItem(key);
    if (!id) { id = "p" + crypto.getRandomValues(new Uint32Array(2)).join("").slice(0, 14); localStorage.setItem(key, id); }
    return id;
  } catch (_) {
    return "p" + Math.random().toString(36).slice(2, 12);
  }
}
