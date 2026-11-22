// Attrappe von firebase/firestore für die Playwright-Tests (#321): Daten im Speicher (window.__testdaten), nur was die Verwaltung braucht.
// Schalter für Fehlerfälle: window.__einmalScheitern, __getDocScheitern, __zaehlenScheitern, __kuenstlerVerzoegern (ms), __altStand.
const daten = window.__testdaten ?? {}; window.__daten = daten;
// Feste Zeiten in den Testdaten: { __ms: Zahl } wird ein Timestamp.
const fest = ms => ({ toDate: () => new Date(ms), toMillis: () => ms, seconds: ms / 1000 });
(function beleben(o) { for (const [k, v] of Object.entries(o ?? {})) {
  if (v && typeof v === "object") { if ("__ms" in v) o[k] = fest(v.__ms); else beleben(v); } } })(daten);
let n = 0;
const ts = () => ({ toDate: () => new Date(), toMillis: () => Date.now(), seconds: Date.now() / 1000 });
export class FieldPath { constructor(...t) { this.t = t; } }
export const deleteField = () => ({ __loeschen: true });
export const serverTimestamp = () => ts();
export const initializeFirestore = () => ({});
export const getFirestore = () => ({});
const pfad = (p, s) => ((p && p.pfad ? p.pfad + "/" : "") + s.join("/")).replace(/^artists\/[^/]*/, "artists/k");
export function doc(p, ...s) {
  if (p?.art === "sammlung" && !s.length) s = ["auto" + (++n)];
  const x = pfad(p?.pfad ? p : null, s);
  return { art: "dok", pfad: x, path: x, id: x.split("/").pop() };
}
export function collection(p, ...s) { const x = pfad(p?.pfad ? p : null, s); return { art: "sammlung", pfad: x, id: x.split("/").pop() }; }
export const where = (f, op, w) => ({ f, op, w });
// orderBy: wie Firestore nur Dokumente, die das Feld haben (zum Zählen je Feld, #343); sortiert nicht.
export const orderBy = f => ({ f, op: "hat" }); export const limit = () => null;
export const query = (c, ...b) => ({ ...c, bed: b.filter(Boolean) });
const snapDok = r => ({ id: r.id, ref: r, exists: () => r.pfad in daten, data: () => daten[r.pfad] && kopie(daten[r.pfad]),
  get: f => daten[r.pfad]?.[f] });
const snapDokA = async r => snapDok(r);
export async function getDoc(r) { if (window.__kuenstlerVerzoegern && r.pfad === "artists/k") await new Promise(z => setTimeout(z, window.__kuenstlerVerzoegern)); if (window.__altStand && r.pfad in window.__altStand) return { id: r.id, ref: r, exists: () => true, data: () => kopie(window.__altStand[r.pfad]), get: f => window.__altStand[r.pfad][f] }; if (window.__getDocScheitern && /works\/[^/]*$/.test(r.pfad)) { window.__getDocScheitern = false; throw Object.assign(new Error("Nachladen weg (Testdaten)"), { code: "unavailable" }); } return snapDok(r); }
export const getDocFromServer = r => getDoc(r);
// Ein Dokument (Pfad k) gegen eine Bedingung aus where/orderBy; Zeiten als Millisekunden.
// Unbekannte Operatoren werfen, statt still falsche Treffer zu liefern.
const wert = v => v && typeof v.toMillis === "function" ? v.toMillis() : v;
function passt(k, { f, op, w }) {
  const d = daten[k];
  const v = f === "__id" ? k.split("/").pop() : wert(d[f]);
  const da = f === "__id" || f in d;
  switch (op) {
    case "hat": return da;
    case "==": return da && v === wert(w);
    case "!=": return da && v !== null && v !== wert(w);
    case "<": return da && v < wert(w);
    case "<=": return da && v <= wert(w);
    case ">": return da && v > wert(w);
    case ">=": return da && v >= wert(w);
    case "in": return da && w.map(wert).includes(v);
    case "array-contains": return Array.isArray(d[f]) && d[f].includes(w);
    default: throw new Error(`Attrappe: where-Operator ${op} fehlt`);
  }
}
export async function getDocs(q) {
  const tiefe = q.pfad.split("/").length + 1;
  const docs = Object.keys(daten).filter(k => k.startsWith(q.pfad + "/") && k.split("/").length === tiefe)
    .filter(k => (q.bed ?? []).every(b => b.f === undefined || passt(k, b)))
    .map(k => snapDok({ art: "dok", pfad: k, id: k.split("/").pop() }));
  return { docs, size: docs.length, empty: !docs.length, forEach: f => docs.forEach(f) };
}
export function onSnapshot(r, ok) { (r.art === "dok" ? getDoc(r) : getDocs(r)).then(ok); return () => {}; }
function setzen(r, d) { daten[r.pfad] = kopie(d); }
function aendern(r, felder) {
  const d = daten[r.pfad] ?? {};
  for (const [k, v] of Object.entries(felder)) { if (v?.__loeschen) delete d[k]; else d[k] = v; }
  daten[r.pfad] = d;
}
export async function setDoc(r, d) { setzen(r, d); }
export async function updateDoc(r, ...a) { aendern(r, paare(a)); }
const paare = a => a.length === 1 ? a[0] : Object.fromEntries(Array.from({ length: a.length / 2 }, (_, i) => [a[2 * i] instanceof FieldPath ? a[2 * i].t.join(".") : a[2 * i], a[2 * i + 1]]));
export async function runTransaction(db, f) {
  if (window.__einmalScheitern) { window.__einmalScheitern = false; throw Object.assign(new Error("Netz weg (Testdaten)"), { code: "unavailable" }); }
  return f({ get: snapDokA, set: (r, d) => setzen(r, d), update: (r, ...a) => aendern(r, paare(a)), delete: r => delete daten[r.pfad] });
}
export const Timestamp = { now: ts };
export async function addDoc(c, d) {
  const r = doc(c);
  // Testdaten: wie die Funktion hochladen (gcf/upload.js), sofort mit Test-URL.
  if (c.pfad.endsWith("/uploads")) d = { ...d, status: "bereit", url: "/__upload/" + d.name,
    pfad: c.pfad.replace(/uploads$/, "works/") + d.werk + "/test-" + d.name };
  setzen(r, d); return r;
}
export const startAfter = () => null; export const documentId = () => "__id";
function kopie(x) {
  if (Array.isArray(x)) return x.map(kopie);
  if (x && typeof x === "object" && Object.getPrototypeOf(x) === Object.prototype && !x.toDate)
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, kopie(v)]));
  return x;
}
export async function getCountFromServer(q) {
  if (window.__zaehlenScheitern) throw Object.assign(new Error("Zählen weg (Testdaten)"), { code: "unavailable" });
  const s = await getDocs(q); return { data: () => ({ count: s.size }) };
}
