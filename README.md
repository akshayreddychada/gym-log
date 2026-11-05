# Gym Log

A phone-first workout tracker for a fixed 5-day split (Chest + Abs, Shoulders + Biceps, Legs + Abs, Back + Triceps, Rest), with steps and body weight.

- Hosted on GitHub Pages, data in Firebase (Auth: Email/Password, Firestore).
- Firebase config goes in `js/config.js`.
- `vendor/firebase.js` is the Firebase JS SDK 13.2.0, bundled with esbuild.
- Local testing: serve the folder and open `http://localhost:…/` with no config set; it uses a localStorage stand-in for Firebase.
