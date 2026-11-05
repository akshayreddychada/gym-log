// Local stand-in for Firebase, used only when running on localhost for testing.
// Same interface as db-firebase.js; data lives in localStorage.
export function createDb() {
  const K = 'gymlog-mock';
  const load = () => { try { return JSON.parse(localStorage.getItem(K)) || {}; } catch { return {}; } };
  let db = load();
  const save = () => localStorage.setItem(K, JSON.stringify(db));
  const authCbs = new Set();
  const watchers = new Set();
  let user = db.__session ? { uid: db.__session, email: db.__users?.[db.__session]?.email } : null;

  const u = (uid) => (db[uid] ||= { settings: null, sessions: {}, daily: {} });
  const emit = (uid) => {
    const d = u(uid);
    for (const w of watchers) if (w.uid === uid) {
      w.onSettings(d.settings ? structuredClone(d.settings) : null);
      w.onSessions(Object.values(d.sessions).map((s) => structuredClone(s)));
      w.onDaily(structuredClone(d.daily));
    }
  };
  const setUser = (x) => { user = x; db.__session = x?.uid || null; save(); authCbs.forEach((cb) => cb(user)); };
  const later = (f) => new Promise((res, rej) => setTimeout(() => { try { res(f()); } catch (e) { rej(e); } }, 50));
  const err = (code) => Object.assign(new Error(code), { code });

  return {
    onAuth(cb) { authCbs.add(cb); setTimeout(() => cb(user), 0); return () => authCbs.delete(cb); },
    signIn: (e, p) => later(() => {
      const hit = Object.entries(db.__users || {}).find(([, v]) => v.email === e.toLowerCase());
      if (!hit || hit[1].p !== p) throw err('auth/invalid-credential');
      setUser({ uid: hit[0], email: hit[1].email });
    }),
    signUp: (e, p) => later(() => {
      db.__users ||= {};
      if (!/^\S+@\S+\.\S+$/.test(e)) throw err('auth/invalid-email');
      if (p.length < 6) throw err('auth/weak-password');
      if (Object.values(db.__users).some((v) => v.email === e.toLowerCase())) throw err('auth/email-already-in-use');
      const id = 'u' + Math.random().toString(36).slice(2, 8);
      db.__users[id] = { email: e.toLowerCase(), p };
      setUser({ uid: id, email: e.toLowerCase() });
    }),
    resetPassword: () => later(() => {}),
    signOut: () => later(() => setUser(null)),

    watch(uid, handlers) {
      const w = { uid, ...handlers };
      watchers.add(w);
      setTimeout(() => emit(uid), 0);
      return () => watchers.delete(w);
    },
    saveSettings: (uid, s) => { u(uid).settings = structuredClone(s); save(); emit(uid); return Promise.resolve(); },
    saveSession: (uid, s) => { u(uid).sessions[s.id] = structuredClone(s); save(); emit(uid); return Promise.resolve(); },
    deleteSession: (uid, id) => { delete u(uid).sessions[id]; save(); emit(uid); return Promise.resolve(); },
    saveDaily: (uid, date, d) => { u(uid).daily[date] = structuredClone(d); save(); emit(uid); return Promise.resolve(); },
  };
}
