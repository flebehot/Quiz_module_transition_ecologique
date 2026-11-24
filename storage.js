// =============================================================
//  Stockage des quiz
//  - "local"  : dans ce navigateur (localStorage), sans configuration
//  - "github" : un fichier JSON par quiz dans un dépôt GitHub (privé)
//  + export / import de fichiers JSON dans les deux cas
// =============================================================

import { normalizeQuiz } from "./model.js";

const LS_QUIZ = "quizapp:quiz:";
const LS_SETTINGS = "quizapp:settings";

const DEFAULT_SETTINGS = {
  mode: "local",
  github: { owner: "", repo: "", branch: "main", dossier: "quiz", token: "" }
};

function lsGet(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
function lsSet(key, v) { try { localStorage.setItem(key, v); return true; } catch (_) { return false; } }
function lsDel(key) { try { localStorage.removeItem(key); } catch (_) {} }

export function getSettings() {
  try {
    const s = JSON.parse(lsGet(LS_SETTINGS) || "{}");
    return { ...DEFAULT_SETTINGS, ...s, github: { ...DEFAULT_SETTINGS.github, ...(s.github || {}) } };
  } catch (_) { return structuredClone(DEFAULT_SETTINGS); }
}
export function saveSettings(s) { lsSet(LS_SETTINGS, JSON.stringify(s)); }

const summary = (q) => ({ id: q.id, titre: q.titre, maj: q.maj, nb: q.questions.length });

// ---------------- Stockage navigateur ----------------
export class LocalStore {
  constructor() { this.mode = "local"; this.label = "Ce navigateur"; }
  async list() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS_QUIZ)) {
          try { out.push(summary(JSON.parse(localStorage.getItem(k)))); } catch (_) {}
        }
      }
    } catch (_) {}
    return out.sort((a, b) => (b.maj || "").localeCompare(a.maj || ""));
  }
  async load(id) {
    const raw = lsGet(LS_QUIZ + id);
    if (!raw) throw new Error("Quiz introuvable dans ce navigateur.");
    return JSON.parse(raw);
  }
  async save(quiz) {
    if (!lsSet(LS_QUIZ + quiz.id, JSON.stringify(quiz))) throw new Error("Impossible d'écrire dans le stockage du navigateur.");
  }
  async remove(id) { lsDel(LS_QUIZ + id); }
}

// ---------------- Stockage GitHub ----------------
function b64encodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decodeUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export class GitHubStore {
  constructor(cfg) {
    this.mode = "github";
    this.cfg = cfg;
    this.label = `GitHub · ${cfg.owner}/${cfg.repo}`;
    this.shas = {};
  }
  get dir() { return (this.cfg.dossier || "quiz").replace(/^\/+|\/+$/g, ""); }
  path(id) { return `${this.dir}/${id}.json`; }

  async api(path, opts = {}) {
    const res = await fetch(`https://api.github.com/repos/${this.cfg.owner}/${this.cfg.repo}${path}`, {
      ...opts,
      cache: "no-store",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${this.cfg.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(opts.body ? { "Content-Type": "application/json" } : {})
      }
    });
    if (res.status === 404 && opts.allow404) return null;
    if (!res.ok) {
      let msg = "";
      try { msg = (await res.json()).message; } catch (_) {}
      const hints = {
        401: "jeton invalide ou expiré",
        403: "accès refusé (droits du jeton ?)",
        404: "dépôt ou fichier introuvable (nom du dépôt ? accès du jeton ?)",
        409: "conflit de version",
        422: "requête refusée"
      };
      throw new Error(`GitHub : ${hints[res.status] || "erreur " + res.status}${msg ? " — " + msg : ""}`);
    }
    return res.status === 204 ? null : res.json();
  }

  /** Vérifie l'accès au dépôt et le droit d'écriture. */
  async test() {
    const repo = await this.api("");
    if (!repo.private) return { ok: true, warn: "Attention : ce dépôt est PUBLIC. Les bonnes réponses de vos quiz y seraient visibles par tous." };
    if (repo.permissions && repo.permissions.push === false) return { ok: false, warn: "Le jeton permet de lire mais pas d'écrire dans ce dépôt." };
    return { ok: true };
  }

  async list() {
    const files = await this.api(`/contents/${this.dir}?ref=${encodeURIComponent(this.cfg.branch)}`, { allow404: true });
    if (!files) return [];
    const json = files.filter(f => f.type === "file" && f.name.endsWith(".json"));
    const out = await Promise.all(json.map(async f => {
      try { return summary(await this.load(f.name.replace(/\.json$/, ""))); }
      catch (_) { return { id: f.name.replace(/\.json$/, ""), titre: f.name + " (illisible)", maj: "", nb: 0 }; }
    }));
    return out.sort((a, b) => (b.maj || "").localeCompare(a.maj || ""));
  }

  async load(id) {
    const f = await this.api(`/contents/${this.path(id)}?ref=${encodeURIComponent(this.cfg.branch)}`);
    this.shas[id] = f.sha;
    return JSON.parse(b64decodeUtf8(f.content));
  }

  async save(quiz) {
    const put = (sha) => this.api(`/contents/${this.path(quiz.id)}`, {
      method: "PUT",
      body: JSON.stringify({
        message: `Quiz « ${quiz.titre} » mis à jour`,
        content: b64encodeUtf8(JSON.stringify(quiz, null, 2) + "\n"),
        branch: this.cfg.branch,
        ...(sha ? { sha } : {})
      })
    });
    let sha = this.shas[quiz.id];
    if (!sha) {
      const existing = await this.api(`/contents/${this.path(quiz.id)}?ref=${encodeURIComponent(this.cfg.branch)}`, { allow404: true });
      sha = existing && existing.sha;
    }
    let r;
    try { r = await put(sha); }
    catch (e) {
      // version modifiée ailleurs entre-temps : on reprend la dernière version connue
      if (!/conflit|409|422/.test(e.message)) throw e;
      const existing = await this.api(`/contents/${this.path(quiz.id)}?ref=${encodeURIComponent(this.cfg.branch)}`, { allow404: true });
      r = await put(existing && existing.sha);
    }
    this.shas[quiz.id] = r.content.sha;
  }

  async remove(id) {
    let sha = this.shas[id];
    if (!sha) { const f = await this.api(`/contents/${this.path(id)}?ref=${encodeURIComponent(this.cfg.branch)}`); sha = f.sha; }
    await this.api(`/contents/${this.path(id)}`, {
      method: "DELETE",
      body: JSON.stringify({ message: `Quiz ${id} supprimé`, sha, branch: this.cfg.branch })
    });
    delete this.shas[id];
  }
}

export function makeStore(settings = getSettings()) {
  const g = settings.github;
  if (settings.mode === "github" && g.owner && g.repo && g.token) return new GitHubStore(g);
  return new LocalStore();
}

// ---------------- Export / import de fichiers ----------------
export function exportQuizFile(quiz) {
  const blob = new Blob([JSON.stringify(quiz, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = quiz.id + ".json";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function importQuizFiles() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.multiple = true;
    input.onchange = async () => {
      const ok = [], errors = [];
      for (const f of input.files) {
        try { ok.push(normalizeQuiz(JSON.parse(await f.text()))); }
        catch (e) { errors.push(`${f.name} : ${e.message}`); }
      }
      resolve({ ok, errors });
    };
    input.click();
  });
}
