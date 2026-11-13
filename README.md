# Gym Log

A phone-first personal health log: strength training on a fixed split (Chest + Abs, Shoulders + Biceps, Legs + Abs, Back + Triceps, Rest), plus food, water, supplements, posture (anterior pelvic tilt) and core work, steps, body weight and WHOOP recovery.

- **Today**: day score, next split day, calories and macros, water, steps, posture and core checklist, supplements, WHOOP numbers. Any past day can be filled in with the date switcher.
- **Train**: tap muscles on a front and back body map, or pick a split day, to build the session. Colours show how recently each muscle was trained.
- **Fuel**: meals built from a healthy-foods database (`js/foods.js`, per 100 g). Macros are calculated from the amount and unit picked.
- **Trends**: day score, sets per muscle per week, lift progress, calories, protein, water, steps, body weight, recovery, and habit consistency.
- **History**: a calendar of every day with its full breakdown.

Tech:
- Hosted on GitHub Pages, data in Firebase (Auth: Email/Password, Firestore under `users/{uid}`).
- Firebase config goes in `js/config.js`.
- `vendor/firebase.js` is the Firebase JS SDK 13.2.0, bundled with esbuild.
- Local testing: serve the folder and open `http://localhost:…/?mock`. That uses a localStorage stand-in for Firebase.
