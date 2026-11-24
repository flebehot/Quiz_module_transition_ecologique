// =============================================================
//  Configuration de l'application
// =============================================================

// Adresse de la base Firebase Realtime Database (sessions en direct).
// À copier depuis la console Firebase, onglet « Données » (commence par https://, finit par .app).
export const FIREBASE_URL = "https://quiz-formation-te-default-rtdb.europe-west1.firebasedatabase.app";

// Rythme de rafraîchissement en mode polling (millisecondes).
export const POLL_MS = 1500;

// Les sessions plus anciennes sont effacées automatiquement à la création d'une nouvelle session.
export const SESSION_MAX_AGE_H = 24;
