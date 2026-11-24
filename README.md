# Quiz formation

Application de quiz pour animer des sessions de formation (20 participants maximum) :
création de quiz, sauvegarde, puis diffusion en direct avec réponses sur téléphone via QR code.

Site 100 % statique hébergé sur GitHub Pages : aucun serveur, aucune étape de compilation.

## État d'avancement

| Étape | Contenu | État |
|---|---|---|
| 1 | Format des quiz, éditeur, aperçu participant, stockage navigateur / GitHub, export-import | ✅ livré |
| 2 | Session en direct : QR code, interface de réponse mobile, écran des résultats (Firebase, flux SSE ou polling) | ✅ livré |
| 3 | Matrice avec bonnes réponses, appariement par glisser-déposer | ✅ livré |
| 4 | Question « curseur », classement facultatif (pseudos, points par question, classement final) | ✅ livré |
| — | Page de diagnostic réseau (`diagnostic/`) | ✅ livrée |

## Structure

```
index.html            Espace formateur (liste des quiz, éditeur, réglages)
css/app.css           Styles
js/model.js           Format des quiz : 7 types de questions, validation
js/storage.js         Stockage : navigateur, dépôt GitHub privé, export/import JSON
js/participant.js     Affichage d'une question sur téléphone (réutilisé en session)
js/app.js             Interface formateur
js/dom.js             Utilitaires d'affichage
js/config.js          Adresse de la base Firebase (à adapter si la base change)
js/firebase.js        Accès à Firebase en HTTPS simple : flux SSE, sinon polling (jamais de WebSocket)
js/animer.js          Écran animateur : QR code, questions, résultats en direct, correction
js/repondre.js        Interface participant (téléphone)
js/vendor/qrcode.js   Générateur de QR code (qrcode-generator, licence MIT)
r/index.html          Page ouverte par le QR code
firebase-rules.json   Règles de sécurité à coller dans la console Firebase
diagnostic/           Test des accès réseau (GitHub, Firebase, WebSocket)
.nojekyll             Indique à GitHub Pages de publier les fichiers tels quels
```

## Mise en ligne sur GitHub Pages

1. Créez un dépôt **public** (par exemple `quiz-formation`).
2. *Add file → Upload files* : glissez **le contenu** du dossier (pas le dossier lui-même), y compris `.nojekyll`.
   Sous Windows, les fichiers commençant par un point peuvent être masqués : s'il manque, ce n'est pas bloquant.
3. *Settings → Pages* : *Deploy from a branch*, branche `main`, dossier `/ (root)`.
4. L'application est en ligne à `https://<identifiant>.github.io/quiz-formation/`.

Pour une mise à jour : *Add file → Upload files* et déposer les fichiers modifiés, qui remplacent les anciens.

## Sauvegarde des quiz

Deux modes, au choix dans **Réglages** :

- **Ce navigateur** : rien à configurer, idéal pour essayer. Les quiz restent sur ce poste. Pensez à exporter.
- **Dépôt GitHub privé** (recommandé) : un fichier JSON par quiz dans un **second dépôt, privé**
  (par exemple `mes-quiz`), avec historique des versions. Les bonnes réponses ne sont jamais publiées
  sur le site public. L'accès se fait par un jeton « fine-grained » limité à ce seul dépôt
  (permission *Contents : Read and write*), conservé uniquement dans le navigateur du formateur.

Le bouton **Exporter** télécharge un quiz en fichier `.json` ; **Importer un fichier** le recharge.

## Session en direct

1. Dans **Mes quiz**, cliquez sur **▶ Animer** (le quiz doit être complet).
2. L'écran affiche un QR code et un code de session : les participants scannent, ou ouvrent l'adresse `…/r/` et tapent le code.
3. Pour chaque question : **Clore les réponses** → **Révéler la bonne réponse** (si la question en a une) → **Question suivante**.
   La barre d'espace ou la flèche → enchaîne ces étapes ; **F** passe en plein écran.
4. En fin de quiz : **Fermer la session et effacer les réponses**.

Si l'option **Classement des participants** est cochée dans le quiz, chacun saisit un pseudo ; les points
(0 à 1000 par question) sont attribués à la révélation de la bonne réponse, et le classement s'affiche en fin de quiz.
Curseur : valeur exacte = 2 × les points ; sinon points × (1 − écart / écart maximal possible), arrondi.
Sans classement, les participants sont anonymes. Les réponses sont supprimées à la fermeture de la session ;
les sessions oubliées sont effacées automatiquement au bout de 24 h (au lancement d'une nouvelle session).
Si la page de l'animateur est rechargée par erreur, l'application propose de reprendre la session en cours.

### Règles de sécurité Firebase (à faire une fois)

Console Firebase → *Realtime Database* → onglet **Règles** → remplacez tout le contenu par celui de
`firebase-rules.json` → **Publier**. Ces règles remplacent le « mode test » (qui expire au bout de 30 jours) :
seule la partie sessions est accessible, et une réponse n'est acceptée que pendant que la question est ouverte.

Limite connue : sans compte animateur, une personne techniquement avertie connaissant l'adresse de la base
pourrait perturber une session en cours. Le risque est faible dans un cadre de formation interne.

## Format d'un quiz (`quiz-formation/1`)

```json
{
  "format": "quiz-formation/1",
  "id": "securite-incendie-ab12c",
  "titre": "Sécurité incendie",
  "description": "",
  "creation": "2026-11-24T12:00:00.000Z",
  "maj": "2026-11-24T12:00:00.000Z",
  "questions": [
    { "type": "choix", "enonce": "…", "multiple": false,
      "options": [{ "id": "o1", "texte": "…", "correcte": true }] },
    { "type": "matrice", "enonce": "…", "multiple": false,
      "lignes": [{ "id": "l1", "texte": "…" }], "colonnes": [{ "id": "c1", "texte": "…" }] },
    { "type": "echelle", "enonce": "…", "max": 5,
      "libelleMin": "Complètement en désaccord", "libelleMax": "Complètement d'accord" },
    { "type": "vraifaux", "enonce": "…", "reponse": true },
    { "type": "intrus", "enonce": "…", "affirmations": [{ "id": "a1", "texte": "…" }], "intrus": "a1" },
    { "type": "appariement", "enonce": "…", "paires": [{ "id": "p1", "gauche": "…", "droite": "…" }] },
    { "type": "nuage", "enonce": "…", "maxMots": 3 }
  ]
}
```

Chaque question porte aussi un `id` et une `explication` facultative, affichée à la correction.
