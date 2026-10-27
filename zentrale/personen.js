import { api } from "./gcp.js";
import { websites } from "./websites.js";

/**
 * Personen und Super-Admins einer Website (#78). Die Zentrale schreibt mit IAM
 * (infra/gcp), an den Firestore-Regeln vorbei; was die Regeln sonst prüfen,
 * prüft sie hier selbst.
 */

// Wie BERECHTIGUNGEN in src/werkverzeichnis/permissions.js und firestore.rules.
export const ROLLEN = { admin: "Admin", editor: "Bearbeiter:in" };
const HOECHSTENS = 50;

export async function website(seite) {
  const w = (await websites()).find(x => x.seite === seite);
  if (!w) throw new Error(`Keine Website ${seite}`);
  return w;
}

const dokument = w => `projects/${w.projekt}/databases/${w.datenbank}/documents/artists/${w.kuenstler}`;
const firestore = "https://firestore.googleapis.com/v1/";

// Firebase Auth des Projekts; die Anfragen zählen auf sein Kontingent.
const auth = (w, pfad, daten) => api(`https://identitytoolkit.googleapis.com/v1/projects/${w.projekt}/${pfad}`,
  daten, { "x-goog-user-project": w.projekt });

const claims = n => { try { return JSON.parse(n.customAttributes ?? "{}"); } catch { return {}; } };

export function pruefeEmail(eingabe) {
  const email = String(eingabe ?? "").trim().toLowerCase();
  if (!/^[^\s@`\\]+@[^\s@`\\]+\.[^\s@`\\]+$/.test(email)) throw new Error(`Keine gültige E-Mail-Adresse: ${eingabe}`);
  return email;
}

/** Rollen (E-Mail → Rolle), dazu alle, die sich je angemeldet haben. */
export async function personen(w) {
  const [d, a] = await Promise.all([
    api(firestore + dokument(w)).catch(f => f.message.startsWith("404") ? null : Promise.reject(f)),
    auth(w, "accounts:query", { returnUserInfo: true, limit: "500" }),
  ]);
  const rollen = Object.fromEntries(Object.entries(d?.fields?.roles?.mapValue?.fields ?? {})
    .map(([email, v]) => [email, v.stringValue]));
  const konten = new Map((a.userInfo ?? []).filter(n => n.email).map(n => [n.email.toLowerCase(), {
    zuletzt: n.lastLoginAt ? new Date(Number(n.lastLoginAt)).toISOString() : "",
    superAdmin: claims(n).superAdmin === true,
  }]));
  return { gibtDokument: !!d, rollen, konten };
}

/** Setzt die Rolle einer Person; ohne Rolle wird sie entfernt. */
export async function rolleSetzen(w, eingabe, rolle) {
  const email = pruefeEmail(eingabe);
  if (rolle && !ROLLEN[rolle]) throw new Error(`Unbekannte Rolle ${rolle}`);
  const { gibtDokument, rollen } = await personen(w);
  if (!gibtDokument) throw new Error("Es gibt noch kein Künstler:in-Dokument");
  if (rolle && !(email in rollen) && Object.keys(rollen).length >= HOECHSTENS)
    throw new Error(`Höchstens ${HOECHSTENS} Personen`);
  // Nur dieses eine Feld der Map: Was andere gleichzeitig ändern, bleibt.
  const feld = "roles.`" + email + "`";
  await api(`${firestore}projects/${w.projekt}/databases/${w.datenbank}/documents:commit`, {
    writes: [{
      update: { name: dokument(w), fields: { roles: { mapValue: { fields: rolle ? { [email]: { stringValue: rolle } } : {} } } } },
      updateMask: { fieldPaths: [feld] },
      updateTransforms: [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }],
      currentDocument: { exists: true },
    }],
  });
}

/**
 * Vergibt oder entzieht den Claim superAdmin (wie früher tools/super_admin.mjs).
 * Die Person muss sich einmal angemeldet haben; es wirkt bei ihrer nächsten
 * Anmeldung, spätestens nach einer Stunde.
 */
export async function superAdminSetzen(w, eingabe, ja) {
  const email = pruefeEmail(eingabe);
  const { users } = await auth(w, "accounts:lookup", { email: [email] });
  if (!users?.length) throw new Error(`${email} hat sich noch nie angemeldet; erst einmal anmelden lassen`);
  const nutzer = users[0];
  const { superAdmin, ...rest } = claims(nutzer);
  const neu = ja ? { ...rest, superAdmin: true } : rest;
  await auth(w, "accounts:update", { localId: nutzer.localId, customAttributes: JSON.stringify(neu) });
}
