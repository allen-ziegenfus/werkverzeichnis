// Attrappe von firebase/firestore/lite (#321): liest dieselben Daten wie firebase_firestore.js (window.__daten).
const kopie = x => JSON.parse(JSON.stringify(x, (k, v) => v && v.toMillis ? { __ms: v.toMillis() } : v),
  (k, v) => v && typeof v === "object" && "__ms" in v ? { toDate: () => new Date(v.__ms), toMillis: () => v.__ms, seconds: v.__ms / 1000 } : v);
export const getFirestore = () => ({});
// Wie das volle SDK: relativ zu einem Dokument (doc(kuenstler, "pfade", id)) oder ein ganzer Pfad.
export function doc(p, ...s) {
  const x = ((p?.pfad ? p.pfad + "/" : "") + s.join("/")).replace(/^artists\/[^/]*/, "artists/k");
  return { pfad: x, path: x, id: x.split("/").pop() };
}
export async function getDoc(r) {
  const d = window.__daten ?? {};
  return { id: r.id, ref: r, exists: () => r.pfad in d, data: () => d[r.pfad] && kopie(d[r.pfad]), get: f => d[r.pfad]?.[f] };
}
