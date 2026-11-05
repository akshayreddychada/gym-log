// Firestore layout:
//   users/{uid}/meta/settings      units, rest timer, step goal, routine
//   users/{uid}/sessions/{id}      one workout (or rest day) each
//   users/{uid}/daily/{YYYY-MM-DD} steps and body weight
import {
  initializeApp, getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail, signOut,
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, setDoc, deleteDoc, collection, onSnapshot,
} from '../vendor/firebase.js';

export function createDb(config) {
  const app = initializeApp(config);
  const auth = getAuth(app);
  let fs;
  try {
    // Offline cache: logging keeps working with no signal in the gym and
    // syncs once the phone is back online.
    fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch {
    fs = initializeFirestore(app, {});
  }
  const clean = (o) => JSON.parse(JSON.stringify(o));

  return {
    onAuth: (cb) => onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, email: u.email } : null)),
    signIn: (e, p) => signInWithEmailAndPassword(auth, e, p),
    signUp: (e, p) => createUserWithEmailAndPassword(auth, e, p),
    resetPassword: (e) => sendPasswordResetEmail(auth, e),
    signOut: () => signOut(auth),

    watch(uid, { onSettings, onSessions, onDaily, onError }) {
      const unsubs = [
        onSnapshot(doc(fs, 'users', uid, 'meta', 'settings'), (d) => onSettings(d.exists() ? d.data() : null), onError),
        onSnapshot(collection(fs, 'users', uid, 'sessions'), (q) => onSessions(q.docs.map((d) => d.data())), onError),
        onSnapshot(collection(fs, 'users', uid, 'daily'), (q) => onDaily(Object.fromEntries(q.docs.map((d) => [d.id, d.data()]))), onError),
      ];
      return () => unsubs.forEach((u) => u());
    },
    saveSettings: (uid, s) => setDoc(doc(fs, 'users', uid, 'meta', 'settings'), clean(s)),
    saveSession: (uid, s) => setDoc(doc(fs, 'users', uid, 'sessions', s.id), clean(s)),
    deleteSession: (uid, id) => deleteDoc(doc(fs, 'users', uid, 'sessions', id)),
    saveDaily: (uid, date, data) => setDoc(doc(fs, 'users', uid, 'daily', date), clean(data)),
  };
}
