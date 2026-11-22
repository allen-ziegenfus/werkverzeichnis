// Attrappe von firebase/auth für die Playwright-Tests (#321): immer angemeldet als testperson@example.org.
const nutzer = { email: "testperson@example.org", uid: "test", displayName: "Testperson",
  getIdTokenResult: async () => ({ claims: {} }), getIdToken: async () => "test" };
export const getAuth = () => ({ currentUser: nutzer });
export function onAuthStateChanged(a, f) { setTimeout(() => f(nutzer)); return () => {}; }
export class GoogleAuthProvider { setCustomParameters() {} addScope() {} }
export const signInWithPopup = async () => ({ user: nutzer });
export const signOut = async () => {};
