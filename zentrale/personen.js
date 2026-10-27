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

/** Alle Konten in Firebase Auth des Projekts, seitenweise. */
async function konten(w) {
  const alle = [];
  for (let offset = 0; ; offset += 500) {
    const { userInfo = [] } = await auth(w, "accounts:query",
      { returnUserInfo: true, limit: "500", offset: String(offset) });
    alle.push(...userInfo);
    if (userInfo.length < 500) return alle;
  }
}

const rollenDokument = w => api(firestore + dokument(w)).catch(f => f.message.startsWith("404") ? null : Promise.reject(f));
const rollenVon = d => Object.fromEntries(Object.entries(d?.fields?.roles?.mapValue?.fields ?? {})
  .map(([email, v]) => [email, v.stringValue]));

/** Rollen (E-Mail → Rolle), dazu alle, die sich je angemeldet haben. */
export async function personen(w) {
  const [d, a] = await Promise.all([rollenDokument(w), konten(w)]);
  const rollen = rollenVon(d);
  const angemeldet = new Map(a.filter(n => n.email).map(n => [n.email.toLowerCase(), {
    zuletzt: n.lastLoginAt ? new Date(Number(n.lastLoginAt)).toISOString() : "",
    superAdmin: claims(n).superAdmin === true,
  }]));
  return { gibtDokument: !!d, rollen, konten: angemeldet };
}

/**
 * Setzt die Rolle einer Person; ohne Rolle wird sie entfernt. Geschrieben wird
 * nur, wenn das Dokument noch so ist wie gelesen (updateTime); sonst neu lesen
 * und prüfen, damit zwei gleichzeitige Eintragungen die Grenze nicht überschreiten.
 */
export async function rolleSetzen(w, eingabe, rolle) {
  const email = pruefeEmail(eingabe);
  if (rolle && !Object.hasOwn(ROLLEN, rolle)) throw new Error(`Unbekannte Rolle ${rolle}`);
  for (let versuch = 1; ; versuch++) {
    const d = await rollenDokument(w);
    if (!d) throw new Error("Es gibt noch kein Künstler:in-Dokument");
    const rollen = rollenVon(d);
    if (rolle && !Object.hasOwn(rollen, email) && Object.keys(rollen).length >= HOECHSTENS)
      throw new Error(`Höchstens ${HOECHSTENS} Personen`);
    try {
      // Nur dieses eine Feld der Map.
      await api(`${firestore}projects/${w.projekt}/databases/${w.datenbank}/documents:commit`, {
        writes: [{
          update: { name: dokument(w), fields: { roles: { mapValue: { fields: rolle ? { [email]: { stringValue: rolle } } : {} } } } },
          updateMask: { fieldPaths: ["roles.`" + email + "`"] },
          updateTransforms: [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }],
          currentDocument: { updateTime: d.updateTime },
        }],
      });
      return;
    } catch (f) {
      if (versuch >= 3 || !/FAILED_PRECONDITION|ABORTED/.test(f.message)) throw f;
    }
  }
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
