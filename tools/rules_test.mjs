/**
 * Testet firestore.rules über den Test-Endpunkt der Firebase Rules API: kein
 * Emulator (und kein Java), keine Daten werden angefasst. Abfragen (`get`,
 * `exists`, `getAfter`) werden je Fall simuliert.
 *
 *   node tools/rules_test.mjs
 *
 * Zwei Teile:
 *   - die Berechtigungsmatrix, erzeugt aus src/werkverzeichnis/permissions.js:
 *     jede Rolle (dazu Super-Admin und eine Fremde) × jede Berechtigung, damit
 *     die Tabelle der Regeln und die der Oberfläche nicht auseinanderlaufen
 *   - handgeschriebene Fälle für das, was die Tabelle nicht ausdrückt:
 *     Validierung, Anlegen von Künstler:innen, andere Künstler:innen,
 *     unbestätigte E-Mail-Adressen
 *
 * Läuft mit deinen gcloud Application Default Credentials.
 */
import fs from "fs";
import { GoogleAuth } from "google-auth-library";
import { BERECHTIGUNGEN, ROLLEN } from "../src/werkverzeichnis/permissions.js";

const PROJEKT = process.env.FIRESTORE_PROJECT ?? "vollrad-werkverzeichnis";
const DATENBANK = process.env.FIRESTORE_DATABASE ?? "werkverzeichnis";
const wurzel = `/databases/${DATENBANK}/documents`;

// Der Test-Endpunkt nimmt JSON; RFC-3339-Zeichenketten gelten als gleich request.time.
const JETZT = "2026-10-09T12:00:00Z";
const FRUEHER = "2026-10-01T00:00:00Z";

const SUPER = "super@example.org", FREMDE = "stranger@example.org";
const mitglied = rolle => `${rolle}@example.org`;

const kutscher = {
  titel: "Vollrad Kutscher", websiteTitel: "Werkverzeichnis", titelZeile1: "Werkverzeichnis von",
  titelZeile2: "Vollrad Kutscher", copyright: "Vollrad Kutscher",
  roles: Object.fromEntries(ROLLEN.map(r => [mitglied(r), r])),
  updatedAt: FRUEHER,
};
const werk = { InvNr: "OB1", werkgruppe: "objekte", Titel: "Ding", updatedAt: FRUEHER };
const gruppe = { titel: "Fotografie", kurztitel: null, reihenfolge: 13, updatedAt: JETZT };
const seite = { titel: "Kontakt", kategorie: "Footer", reihenfolge: 1, text: "**Hallo**\n", updatedAt: FRUEHER, lastChange: "s0" };
const fassung = ({ titel, kategorie, reihenfolge, text }) => ({ titel, kategorie, reihenfolge, text });
// Die gespeicherte Seite; ihr Verlaufseintrag s1 enthält genau diese Fassung.
const seiteNeu = { ...seite, text: "Neu\n", updatedAt: JETZT, lastChange: "s1" };

// Die Seite kontakt vor und nach der Anfrage, für Verlaufseinträge.
const KONTAKT = `${wurzel}/artists/kutscher/seiten/kontakt`;
const seiteDavor = d => d
  ? [{ function: "exists", args: [{ exactValue: KONTAKT }], result: { value: true } },
     { function: "get", args: [{ exactValue: KONTAKT }], result: { value: { data: d } } }]
  : [{ function: "exists", args: [{ exactValue: KONTAKT }], result: { value: false } }];
const seiteDanach = d => d
  ? [{ function: "existsAfter", args: [{ exactValue: KONTAKT }], result: { value: true } },
     { function: "getAfter", args: [{ exactValue: KONTAKT }], result: { value: { data: d } } }]
  : [{ function: "existsAfter", args: [{ exactValue: KONTAKT }], result: { value: false } }];
// Eintrag s1 mit genau dieser Fassung, für Fälle mit anderem Text.
const verlaufMit = text => [{ function: "getAfter",
  args: [{ exactValue: `${wurzel}/artists/kutscher/seitenverlauf/s1` }],
  result: { value: { data: { seite: "kontakt", nachher: fassung({ ...seiteNeu, text }) } } } }];
const eintrag = (vorher, nachher) => ({ seite: "kontakt", by: "admin@example.org", at: JETZT, vorher, nachher });

function anmeldung(email, { bestaetigt = true, superAdmin = false } = {}) {
  if (!email) return null;
  return { uid: email, token: { email, email_verified: bestaetigt, ...(superAdmin && { superAdmin: true }) } };
}
const als = wer => wer === SUPER ? anmeldung(SUPER, { superAdmin: true }) : anmeldung(wer);

// Jeder Fall sieht dieselbe Welt: eine Künstlerin, ein Werk, neue Verlaufseinträge
// für Werk und Seite und der Löscheintrag der Seite.
const welt = [
  { function: "get", args: [{ exactValue: `${wurzel}/artists/kutscher` }], result: { value: { data: kutscher } } },
  { function: "get", args: [{ anyValue: {} }], result: { value: null } },
  { function: "getAfter", args: [{ exactValue: `${wurzel}/artists/kutscher/history/h1` }],
    result: { value: { data: { work: "ob1" } } } },
  { function: "getAfter", args: [{ exactValue: `${wurzel}/artists/kutscher/seitenverlauf/s1` }],
    result: { value: { data: { seite: "kontakt", nachher: fassung(seiteNeu) } } } },
  { function: "getAfter", args: [{ exactValue: `${wurzel}/artists/kutscher/seitenverlauf/geloescht-s0` }],
    result: { value: { data: { seite: "kontakt", nachher: null } } } },
  { function: "exists", args: [{ anyValue: {} }], result: { value: false } },
];

// Verlauf für Einstellungen und Werkgruppen (#106).
const einstellungen = d => Object.fromEntries(["titel", "websiteTitel", "titelZeile1", "titelZeile2", "copyright"]
  .map(k => [k, d[k] ?? ""]));
const kutscherNeu = { ...kutscher, titel: "Neu", lastChange: "e1" };
const KUENSTLER = `${wurzel}/artists/kutscher`;
const einstellungsEintrag = nachher => [{ function: "getAfter",
  args: [{ exactValue: `${wurzel}/artists/kutscher/einstellungsverlauf/e1` }], result: { value: { data: { nachher } } } }];
const kuenstlerDanach = d => [{ function: "getAfter", args: [{ exactValue: KUENSTLER }], result: { value: { data: d } } }];
const einstellungsVerlauf = (vorher, nachher) => ({ by: "admin@example.org", at: JETZT, vorher, nachher });
const werkgruppenFassung = ({ titel, kurztitel = null, reihenfolge, cover = null }) => ({ titel, kurztitel, reihenfolge, cover });
const gruppeNeu = { ...gruppe, titel: "Fotos", lastChange: "g1" };
const FOTOGRAFIE = `${wurzel}/artists/kutscher/werkgruppen/fotografie`;
const werkgruppenEintrag = nachher => [{ function: "getAfter",
  args: [{ exactValue: `${wurzel}/artists/kutscher/werkgruppenverlauf/g1` }],
  result: { value: { data: { werkgruppe: "fotografie", nachher } } } }];
const werkgruppeDavor = d => d
  ? [{ function: "exists", args: [{ exactValue: FOTOGRAFIE }], result: { value: true } },
     { function: "get", args: [{ exactValue: FOTOGRAFIE }], result: { value: { data: d } } }]
  : [{ function: "exists", args: [{ exactValue: FOTOGRAFIE }], result: { value: false } }];
const werkgruppeDanach = d => [{ function: "existsAfter", args: [{ exactValue: FOTOGRAFIE }], result: { value: true } },
  { function: "getAfter", args: [{ exactValue: FOTOGRAFIE }], result: { value: { data: d } } }];
const werkgruppenVerlauf = (vorher, nachher) => ({ werkgruppe: "fotografie", by: "admin@example.org", at: JETZT, vorher, nachher });

// Die Werkgruppe objekte gibt es (für das Anlegen von Werken).
const werkgruppeDa = [{ function: "exists", args: [{ exactValue: `${wurzel}/artists/kutscher/werkgruppen/objekte` }],
  result: { value: true } }];

function fall(name, erwartung, auth, methode, pfad, { daten, vorhanden, mocks = [] } = {}) {
  return {
    name,
    expectation: erwartung,
    request: {
      auth, method: methode, path: `${wurzel}/${pfad}`, time: JETZT,
      ...(daten && { resource: { data: daten } }),
    },
    ...(vorhanden && { resource: { data: vorhanden } }),
    functionMocks: [...mocks, ...welt],
  };
}

// Je Berechtigung eine Anfrage, die genau diese Berechtigung braucht und sonst
// gültig ist.
const proben = {
  "lesen": wer => fall(`${wer} lesen`, null, als(wer), "get", "artists/kutscher/works/ob1", { vorhanden: werk }),
  "werke.bearbeiten": wer => fall(`${wer} werke.bearbeiten`, null, als(wer), "update", "artists/kutscher/works/ob1",
    { daten: { ...werk, Titel: "Neu", updatedAt: JETZT, lastChange: "h1" }, vorhanden: werk }),
  "werkgruppen.bearbeiten": wer => fall(`${wer} werkgruppen.bearbeiten`, null, als(wer), "create",
    "artists/kutscher/werkgruppen/fotografie", { daten: gruppe }),
  "seiten.bearbeiten": wer => fall(`${wer} seiten.bearbeiten`, null, als(wer), "update", "artists/kutscher/seiten/kontakt",
    { daten: seiteNeu, vorhanden: seite }),
  "einstellungen.bearbeiten": wer => fall(`${wer} einstellungen.bearbeiten`, null, als(wer), "update", "artists/kutscher",
    { daten: { ...kutscher, titel: "Neu", updatedAt: JETZT }, vorhanden: kutscher }),
  "rollen.verwalten": wer => fall(`${wer} rollen.verwalten`, null, als(wer), "update", "artists/kutscher",
    { daten: { ...kutscher, roles: { ...kutscher.roles, [FREMDE]: "editor" }, updatedAt: JETZT }, vorhanden: kutscher }),
  "veroeffentlichen": wer => fall(`${wer} veroeffentlichen`, null, als(wer), "create", "artists/kutscher/veroeffentlichungen/v1",
    { daten: { von: wer, angefordert: JETZT, status: "angefordert" } }),
};

const alleBerechtigungen = [...new Set(Object.values(BERECHTIGUNGEN).flat())];
const ohneProbe = alleBerechtigungen.filter(b => !proben[b]);
if (ohneProbe.length) {
  console.error(`No probe for permission(s): ${ohneProbe.join(", ")}. Add one to tools/rules_test.mjs.`);
  process.exit(1);
}

const matrix = [];
for (const berechtigung of alleBerechtigungen) {
  for (const rolle of ROLLEN) {
    matrix.push({ ...proben[berechtigung](mitglied(rolle)),
      expectation: BERECHTIGUNGEN[rolle].includes(berechtigung) ? "ALLOW" : "DENY" });
  }
  matrix.push({ ...proben[berechtigung](SUPER), expectation: "ALLOW" });
  matrix.push({ ...proben[berechtigung](FREMDE), expectation: "DENY" });
}

const ADMIN = mitglied("admin"), EDITOR = mitglied("editor");
const neueKuenstlerin = { ...kutscher, titel: "Neue Künstlerin", roles: {}, updatedAt: JETZT };

const faelle = [
  ...matrix,

  fall("auch Super-Admins legen keine Künstlerin an", "DENY", als(SUPER), "create", "artists/neue", { daten: neueKuenstlerin }),
  fall("Admin legt keine Künstler:innen an", "DENY", als(ADMIN), "create", "artists/neue", { daten: neueKuenstlerin }),
  fall("superAdmin-Claim muss true sein, nicht nur wahrheitsähnlich", "DENY",
    { uid: "x", token: { email: "x@example.org", email_verified: true, superAdmin: "yes" } },
    "update", "artists/kutscher", { daten: { ...kutscher, titel: "Neu", updatedAt: JETZT }, vorhanden: kutscher }),
  fall("unbekanntes Feld", "DENY", als(ADMIN), "update", "artists/kutscher",
    { daten: { ...kutscher, extra: 1, updatedAt: JETZT }, vorhanden: kutscher }),
  fall("active gibt es nicht mehr", "DENY", als(ADMIN), "update", "artists/kutscher",
    { daten: { ...kutscher, active: true, updatedAt: JETZT }, vorhanden: kutscher }),
  fall("Zeitstempel vom Client", "DENY", als(ADMIN), "update", "artists/kutscher",
    { daten: { ...kutscher, titel: "Neu", updatedAt: FRUEHER }, vorhanden: kutscher }),
  fall("Titel fehlt", "DENY", als(ADMIN), "update", "artists/kutscher",
    { daten: { ...kutscher, titel: "", updatedAt: JETZT }, vorhanden: kutscher }),
  fall("unbekannte Rolle", "DENY", als(ADMIN), "update", "artists/kutscher",
    { daten: { ...kutscher, roles: { ...kutscher.roles, [FREMDE]: "owner" }, updatedAt: JETZT }, vorhanden: kutscher }),

  fall("auch Super-Admins listen keine Künstler:innen", "DENY", als(SUPER), "list", "artists/kutscher", { vorhanden: kutscher }),
  fall("Mitglied listet nicht", "DENY", als(EDITOR), "list", "artists/kutscher", { vorhanden: kutscher }),
  fall("Fremde listet nicht", "DENY", als(FREMDE), "list", "artists/kutscher", { vorhanden: kutscher }),
  fall("unbestätigte E-Mail liest nicht", "DENY", anmeldung(EDITOR, { bestaetigt: false }), "get",
    "artists/kutscher/works/ob1", { vorhanden: werk }),
  fall("abgemeldet liest nicht", "DENY", null, "get", "artists/kutscher/works/ob1", { vorhanden: werk }),

  fall("Admin ändert Einstellungen und Rollen zusammen", "ALLOW", als(ADMIN), "update", "artists/kutscher",
    { daten: { ...kutscher, titel: "Neu", roles: {}, updatedAt: JETZT }, vorhanden: kutscher }),
  fall("niemand löscht eine Künstlerin", "DENY", als(SUPER), "delete", "artists/kutscher", { vorhanden: kutscher }),

  fall("Admin einer anderen Künstlerin legt keine Werkgruppe an", "DENY", als(ADMIN), "create",
    "artists/andere/werkgruppen/x", { daten: gruppe }),
  fall("Reihenfolge der Werkgruppe muss eine ganze Zahl sein", "DENY", als(ADMIN), "create",
    "artists/kutscher/werkgruppen/fotografie", { daten: { ...gruppe, reihenfolge: "13" } }),
  fall("Werkgruppe hat keinen Bildordner mehr", "DENY", als(ADMIN), "create",
    "artists/kutscher/werkgruppen/fotografie", { daten: { ...gruppe, ordner: "fotografie" } }),
  fall("Werkgruppe ohne aktuellen Zeitstempel", "DENY", als(ADMIN), "update",
    "artists/kutscher/werkgruppen/fotografie", { daten: { ...gruppe, titel: "Neu", updatedAt: FRUEHER }, vorhanden: gruppe }),
  fall("niemand löscht eine Werkgruppe", "DENY", als(SUPER), "delete", "artists/kutscher/werkgruppen/objekte",
    { vorhanden: gruppe }),

  fall("Bearbeiter:in liest Seiten", "ALLOW", als(EDITOR), "get", "artists/kutscher/seiten/kontakt", { vorhanden: seite }),
  fall("Bearbeiter:in löscht keine Seite", "DENY", als(EDITOR), "delete", "artists/kutscher/seiten/kontakt", { vorhanden: seite }),
  fall("Admin löscht eine Seite", "ALLOW", als(ADMIN), "delete", "artists/kutscher/seiten/kontakt", { vorhanden: seite }),
  fall("Seite braucht Header oder Footer", "DENY", als(ADMIN), "create", "artists/kutscher/seiten/neu",
    { daten: { ...seite, kategorie: "Seitenleiste", updatedAt: JETZT } }),
  fall("Text zu lang für zwei Fassungen im Verlauf", "DENY", als(ADMIN), "update", "artists/kutscher/seiten/kontakt",
    { daten: { ...seiteNeu, text: "x".repeat(100001) }, vorhanden: seite, mocks: verlaufMit("x".repeat(100001)) }),
  fall("Admin legt eine Seite mit Verlaufseintrag an", "ALLOW", als(ADMIN), "create", "artists/kutscher/seiten/kontakt",
    { daten: seiteNeu }),
  fall("Seite ohne Verlaufseintrag", "DENY", als(ADMIN), "update", "artists/kutscher/seiten/kontakt",
    { daten: { ...seiteNeu, lastChange: "s9" }, vorhanden: seite }),
  fall("Seite ohne lastChange", "DENY", als(ADMIN), "update", "artists/kutscher/seiten/kontakt",
    { daten: { ...seite, text: "Neu\n", updatedAt: JETZT, lastChange: undefined }, vorhanden: seite }),
  fall("Verlaufseintrag mit anderer Fassung als gespeichert", "DENY", als(ADMIN), "update", "artists/kutscher/seiten/kontakt",
    { daten: { ...seiteNeu, text: "Anders\n" }, vorhanden: seite }),
  fall("Verlaufseintrag einer anderen Seite", "DENY", als(ADMIN), "create", "artists/kutscher/seiten/impressum",
    { daten: seiteNeu }),
  fall("Löschen ohne Löscheintrag", "DENY", als(ADMIN), "delete", "artists/kutscher/seiten/kontakt",
    { vorhanden: { ...seite, lastChange: "s5" } }),
  fall("Löschen einer Seite von vor dem Verlauf braucht geloescht-<seite>", "DENY", als(ADMIN), "delete",
    "artists/kutscher/seiten/kontakt", { vorhanden: { ...seite, lastChange: undefined } }),
  fall("Seitenverlauf beim Speichern", "ALLOW", als(ADMIN), "create", "artists/kutscher/seitenverlauf/s1",
    { daten: eintrag(fassung(seite), fassung(seiteNeu)), mocks: [...seiteDavor(seite), ...seiteDanach(seiteNeu)] }),
  fall("Seitenverlauf beim Anlegen", "ALLOW", als(ADMIN), "create", "artists/kutscher/seitenverlauf/s1",
    { daten: eintrag(null, fassung(seiteNeu)), mocks: [...seiteDavor(null), ...seiteDanach(seiteNeu)] }),
  fall("Seitenverlauf beim Löschen", "ALLOW", als(ADMIN), "create", "artists/kutscher/seitenverlauf/geloescht-s0",
    { daten: eintrag(fassung(seite), null), mocks: [...seiteDavor(seite), ...seiteDanach(null)] }),
  fall("Seitenverlauf ohne Änderung der Seite", "DENY", als(ADMIN), "create", "artists/kutscher/seitenverlauf/s1",
    { daten: eintrag(fassung(seite), fassung(seiteNeu)), mocks: [...seiteDavor(seite), ...seiteDanach(seite)] }),
  fall("Löscheintrag ohne Löschen", "DENY", als(ADMIN), "create", "artists/kutscher/seitenverlauf/geloescht-s0",
    { daten: eintrag(fassung(seite), null), mocks: [...seiteDavor(seite), ...seiteDanach(seite)] }),
  fall("Löscheintrag mit falscher Kennung", "DENY", als(ADMIN), "create", "artists/kutscher/seitenverlauf/geloescht-x",
    { daten: eintrag(fassung(seite), null), mocks: [...seiteDavor(seite), ...seiteDanach(null)] }),
  fall("Seitenverlauf mit vorher null bei vorhandener Seite", "DENY", als(ADMIN), "create", "artists/kutscher/seitenverlauf/s1",
    { daten: eintrag(null, fassung(seiteNeu)), mocks: [...seiteDavor(seite), ...seiteDanach(seiteNeu)] }),
  fall("Seitenverlauf mit falschem vorher", "DENY", als(ADMIN), "create", "artists/kutscher/seitenverlauf/geloescht-s0",
    { daten: eintrag({ ...fassung(seite), text: "erfunden" }, null), mocks: [...seiteDavor(seite), ...seiteDanach(null)] }),
  fall("Seitenverlauf im Namen einer anderen", "DENY", als(ADMIN), "create", "artists/kutscher/seitenverlauf/s1",
    { daten: { ...eintrag(null, fassung(seiteNeu)), by: EDITOR }, mocks: [...seiteDavor(null), ...seiteDanach(seiteNeu)] }),
  fall("Seitenverlauf beim Rückgängigmachen", "ALLOW", als(ADMIN), "create", "artists/kutscher/seitenverlauf/s1",
    { daten: { ...eintrag(fassung(seite), fassung(seiteNeu)), rueckgaengig: "s0" }, mocks: [...seiteDavor(seite), ...seiteDanach(seiteNeu)] }),
  fall("Seitenverlauf mit rueckgaengig keine Zeichenkette", "DENY", als(ADMIN), "create", "artists/kutscher/seitenverlauf/s1",
    { daten: { ...eintrag(fassung(seite), fassung(seiteNeu)), rueckgaengig: 1 }, mocks: [...seiteDavor(seite), ...seiteDanach(seiteNeu)] }),
  fall("Seitenverlauf mit fremdem Feld", "DENY", als(ADMIN), "create", "artists/kutscher/seitenverlauf/s1",
    { daten: { ...eintrag(null, fassung(seiteNeu)), extra: 1 }, mocks: [...seiteDavor(null), ...seiteDanach(seiteNeu)] }),
  fall("niemand ändert den Seitenverlauf", "DENY", als(SUPER), "update", "artists/kutscher/seitenverlauf/s1",
    { daten: { seite: "kontakt", by: SUPER, at: JETZT, vorher: null, nachher: null },
      vorhanden: { seite: "kontakt", by: EDITOR, at: FRUEHER, vorher: null, nachher: null } }),
  fall("Bearbeiter:in liest Bildeinträge", "ALLOW", als(EDITOR), "get", "artists/kutscher/medien/m1",
    { vorhanden: { art: "bild" } }),
  fall("Fremde liest keine Bildeinträge", "DENY", als(FREMDE), "get", "artists/kutscher/medien/m1",
    { vorhanden: { art: "bild" } }),
  fall("niemand schreibt Bildeinträge", "DENY", als(SUPER), "create", "artists/kutscher/medien/m1",
    { daten: { art: "bild" } }),
  fall("niemand löscht den Seitenverlauf", "DENY", als(SUPER), "delete", "artists/kutscher/seitenverlauf/s1",
    { vorhanden: { seite: "kontakt", by: EDITOR, at: FRUEHER, vorher: null, nachher: null } }),
  // Werk anlegen (#179); die Werkgruppe objekte gibt es, andere nicht.
  fall("Werk anlegen", "ALLOW", als(EDITOR), "create", "artists/kutscher/works/ob1",
    { daten: { ...werk, updatedAt: JETZT, lastChange: "h1" }, mocks: werkgruppeDa }),
  fall("Werk anlegen ohne Verlaufseintrag", "DENY", als(EDITOR), "create", "artists/kutscher/works/ob1",
    { daten: { ...werk, updatedAt: JETZT, lastChange: "h2" }, mocks: werkgruppeDa }),
  fall("Werk anlegen in unbekannter Werkgruppe", "DENY", als(EDITOR), "create", "artists/kutscher/works/ob1",
    { daten: { ...werk, werkgruppe: "gibts-nicht", updatedAt: JETZT, lastChange: "h1" }, mocks: werkgruppeDa }),
  fall("Werk anlegen ohne Inv. Nr.", "DENY", als(EDITOR), "create", "artists/kutscher/works/ob1",
    { daten: { ...werk, InvNr: "", updatedAt: JETZT, lastChange: "h1" }, mocks: werkgruppeDa }),
  fall("Werk anlegen mit eigenem Zeitstempel", "DENY", als(EDITOR), "create", "artists/kutscher/works/ob1",
    { daten: { ...werk, updatedAt: FRUEHER, lastChange: "h1" }, mocks: werkgruppeDa }),
  fall("Fremde legt kein Werk an", "DENY", als(FREMDE), "create", "artists/kutscher/works/ob1",
    { daten: { ...werk, updatedAt: JETZT, lastChange: "h1" }, mocks: werkgruppeDa }),
  fall("Werk anlegen unter fremder Kennung", "DENY", als(EDITOR), "create", "artists/kutscher/works/anderes",
    { daten: { ...werk, updatedAt: JETZT, lastChange: "h1" }, mocks: [...werkgruppeDa, { function: "getAfter",
      args: [{ exactValue: `${wurzel}/artists/kutscher/history/h1` }], result: { value: { data: { work: "anderes" } } } }] }),
  fall("Werk anlegen mit Leerzeichen in der Inv. Nr.", "DENY", als(EDITOR), "create", "artists/kutscher/works/ob 1",
    { daten: { ...werk, InvNr: "OB 1", updatedAt: JETZT, lastChange: "h1" }, mocks: werkgruppeDa }),
  fall("Werk anlegen mit doppeltem Bindestrich", "DENY", als(EDITOR), "create", "artists/kutscher/works/ob--1",
    { daten: { ...werk, InvNr: "OB--1", updatedAt: JETZT, lastChange: "h1" }, mocks: werkgruppeDa }),
  fall("Werk anlegen mit Bindestrich am Ende", "DENY", als(EDITOR), "create", "artists/kutscher/works/ob1-",
    { daten: { ...werk, InvNr: "OB1-", updatedAt: JETZT, lastChange: "h1" }, mocks: werkgruppeDa }),
  fall("Werk anlegen mit Bindestrich und Punkt", "ALLOW", als(EDITOR), "create", "artists/kutscher/works/ob-1.2",
    { daten: { ...werk, InvNr: "OB-1.2", updatedAt: JETZT, lastChange: "h3" }, mocks: [...werkgruppeDa,
      { function: "getAfter", args: [{ exactValue: `${wurzel}/artists/kutscher/history/h3` }],
        result: { value: { data: { work: "ob-1.2" } } } }] }),
  fall("Inv. Nr. bleibt", "DENY", als(EDITOR), "update", "artists/kutscher/works/ob1",
    { daten: { ...werk, InvNr: "OB2", updatedAt: JETZT, lastChange: "h1" }, vorhanden: werk }),
  fall("Änderung ohne Verlaufseintrag", "DENY", als(EDITOR), "update", "artists/kutscher/works/ob1",
    { daten: { ...werk, Titel: "Neu", updatedAt: JETZT, lastChange: "h2" }, vorhanden: werk }),
  fall("Veröffentlichung im Namen einer anderen", "DENY", als(ADMIN), "create",
    "artists/kutscher/veroeffentlichungen/v1", { daten: { von: EDITOR, angefordert: JETZT, status: "angefordert" } }),
  fall("Veröffentlichung mit eigenem Status", "DENY", als(ADMIN), "create",
    "artists/kutscher/veroeffentlichungen/v1", { daten: { von: ADMIN, angefordert: JETZT, status: "fertig" } }),
  fall("Veröffentlichung mit Notiz", "ALLOW", als(ADMIN), "create",
    "artists/kutscher/veroeffentlichungen/v1", { daten: { von: ADMIN, angefordert: JETZT, status: "angefordert", notiz: "Neue Werkgruppe" } }),
  fall("Notiz zu lang", "DENY", als(ADMIN), "create",
    "artists/kutscher/veroeffentlichungen/v1", { daten: { von: ADMIN, angefordert: JETZT, status: "angefordert", notiz: "x".repeat(501) } }),
  fall("Notiz keine Zeichenkette", "DENY", als(ADMIN), "create",
    "artists/kutscher/veroeffentlichungen/v1", { daten: { von: ADMIN, angefordert: JETZT, status: "angefordert", notiz: 5 } }),
  fall("niemand ändert eine Veröffentlichung", "DENY", als(SUPER), "update", "artists/kutscher/veroeffentlichungen/v1",
    { daten: { von: SUPER, angefordert: JETZT, status: "fertig" },
      vorhanden: { von: SUPER, angefordert: FRUEHER, status: "angefordert" } }),
  fall("Bearbeiter:in liest Veröffentlichungen", "ALLOW", als(EDITOR), "get", "artists/kutscher/veroeffentlichungen/v1",
    { vorhanden: { von: ADMIN, angefordert: FRUEHER, status: "fertig" } }),
  fall("Verlaufseintrag im Namen einer anderen", "DENY", als(EDITOR), "create", "artists/kutscher/history/h1",
    { daten: { work: "ob1", by: ADMIN, at: JETZT, changes: {} } }),

  // Verlauf für Einstellungen und Werkgruppen (#106); noch nicht verlangt.
  fall("Einstellungen mit Verlaufseintrag", "ALLOW", als(ADMIN), "update", "artists/kutscher",
    { daten: { ...kutscherNeu, updatedAt: JETZT }, vorhanden: kutscher, mocks: einstellungsEintrag(einstellungen(kutscherNeu)) }),
  fall("Einstellungen mit lastChange ohne Eintrag", "DENY", als(ADMIN), "update", "artists/kutscher",
    { daten: { ...kutscherNeu, lastChange: "e9", updatedAt: JETZT }, vorhanden: kutscher }),
  fall("Einstellungen mit Eintrag einer anderen Fassung", "DENY", als(ADMIN), "update", "artists/kutscher",
    { daten: { ...kutscherNeu, updatedAt: JETZT }, vorhanden: kutscher, mocks: einstellungsEintrag(einstellungen(kutscher)) }),
  fall("Einstellungsverlauf beim Speichern", "ALLOW", als(ADMIN), "create", "artists/kutscher/einstellungsverlauf/e1",
    { daten: einstellungsVerlauf(einstellungen(kutscher), einstellungen(kutscherNeu)), mocks: kuenstlerDanach(kutscherNeu) }),
  fall("Einstellungsverlauf mit falschem vorher", "DENY", als(ADMIN), "create", "artists/kutscher/einstellungsverlauf/e1",
    { daten: einstellungsVerlauf(einstellungen(kutscherNeu), einstellungen(kutscherNeu)), mocks: kuenstlerDanach(kutscherNeu) }),
  fall("Einstellungsverlauf ohne passendes lastChange", "DENY", als(ADMIN), "create", "artists/kutscher/einstellungsverlauf/e2",
    { daten: einstellungsVerlauf(einstellungen(kutscher), einstellungen(kutscherNeu)), mocks: kuenstlerDanach(kutscherNeu) }),
  fall("Einstellungsverlauf im Namen einer anderen", "DENY", als(ADMIN), "create", "artists/kutscher/einstellungsverlauf/e1",
    { daten: { ...einstellungsVerlauf(einstellungen(kutscher), einstellungen(kutscherNeu)), by: EDITOR }, mocks: kuenstlerDanach(kutscherNeu) }),
  fall("Bearbeiter:in schreibt keinen Einstellungsverlauf", "DENY", als(EDITOR), "create", "artists/kutscher/einstellungsverlauf/e1",
    { daten: { ...einstellungsVerlauf(einstellungen(kutscher), einstellungen(kutscherNeu)), by: EDITOR }, mocks: kuenstlerDanach(kutscherNeu) }),
  fall("Werkgruppe mit Verlaufseintrag", "ALLOW", als(ADMIN), "update", "artists/kutscher/werkgruppen/fotografie",
    { daten: gruppeNeu, vorhanden: gruppe, mocks: werkgruppenEintrag(werkgruppenFassung(gruppeNeu)) }),
  fall("Werkgruppe mit lastChange ohne Eintrag", "DENY", als(ADMIN), "update", "artists/kutscher/werkgruppen/fotografie",
    { daten: { ...gruppeNeu, lastChange: "g9" }, vorhanden: gruppe }),
  fall("Werkgruppe ohne lastChange (Übergang)", "ALLOW", als(ADMIN), "update", "artists/kutscher/werkgruppen/fotografie",
    { daten: { ...gruppe, titel: "Neu" }, vorhanden: gruppe }),
  fall("Werkgruppenverlauf beim Ändern", "ALLOW", als(ADMIN), "create", "artists/kutscher/werkgruppenverlauf/g1",
    { daten: werkgruppenVerlauf(werkgruppenFassung(gruppe), werkgruppenFassung(gruppeNeu)),
      mocks: [...werkgruppeDavor(gruppe), ...werkgruppeDanach(gruppeNeu)] }),
  fall("Werkgruppenverlauf beim Anlegen", "ALLOW", als(ADMIN), "create", "artists/kutscher/werkgruppenverlauf/g1",
    { daten: werkgruppenVerlauf(null, werkgruppenFassung(gruppeNeu)),
      mocks: [...werkgruppeDavor(null), ...werkgruppeDanach(gruppeNeu)] }),
  fall("Werkgruppenverlauf mit falschem vorher", "DENY", als(ADMIN), "create", "artists/kutscher/werkgruppenverlauf/g1",
    { daten: werkgruppenVerlauf({ ...werkgruppenFassung(gruppe), titel: "erfunden" }, werkgruppenFassung(gruppeNeu)),
      mocks: [...werkgruppeDavor(gruppe), ...werkgruppeDanach(gruppeNeu)] }),
  fall("Werkgruppenverlauf ohne Änderung der Werkgruppe", "DENY", als(ADMIN), "create", "artists/kutscher/werkgruppenverlauf/g1",
    { daten: werkgruppenVerlauf(werkgruppenFassung(gruppe), werkgruppenFassung(gruppeNeu)),
      mocks: [...werkgruppeDavor(gruppe), ...werkgruppeDanach(gruppe)] }),
  fall("Bearbeiter:in schreibt keinen Werkgruppenverlauf", "DENY", als(EDITOR), "create", "artists/kutscher/werkgruppenverlauf/g1",
    { daten: { ...werkgruppenVerlauf(werkgruppenFassung(gruppe), werkgruppenFassung(gruppeNeu)), by: EDITOR },
      mocks: [...werkgruppeDavor(gruppe), ...werkgruppeDanach(gruppeNeu)] }),
  fall("Werkgruppenverlauf mit Pfad als Kennung", "DENY", als(ADMIN), "create", "artists/kutscher/werkgruppenverlauf/g1",
    { daten: { ...werkgruppenVerlauf(werkgruppenFassung(gruppe), werkgruppenFassung(gruppeNeu)), werkgruppe: "../x" },
      mocks: [...werkgruppeDavor(gruppe), ...werkgruppeDanach(gruppeNeu)] }),
  fall("lastChange keine Zeichenkette", "DENY", als(ADMIN), "update", "artists/kutscher/werkgruppen/fotografie",
    { daten: { ...gruppe, lastChange: 5 }, vorhanden: gruppe }),
  fall("niemand ändert den Werkgruppenverlauf", "DENY", als(SUPER), "update", "artists/kutscher/werkgruppenverlauf/g1",
    { daten: werkgruppenVerlauf(null, null), vorhanden: werkgruppenVerlauf(null, null) }),
];

const client = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getClient();
const antwort = await client.request({
  url: `https://firebaserules.googleapis.com/v1/projects/${PROJEKT}:test`,
  method: "POST",
  headers: { "x-goog-user-project": PROJEKT },
  data: {
    source: { files: [{ name: "firestore.rules", content: fs.readFileSync("firestore.rules", "utf8") }] },
    testSuite: { testCases: faelle.map(({ name, ...f }) => f) },
  },
});

let fehlgeschlagen = 0;
for (const problem of antwort.data.issues ?? []) console.log(`rules: ${problem.severity} ${problem.description}`);
antwort.data.testResults.forEach((r, i) => {
  const ok = r.state === "SUCCESS";
  if (!ok) fehlgeschlagen++;
  console.log(`${ok ? "ok  " : "FAIL"} ${faelle[i].expectation.padEnd(5)} ${faelle[i].name}`);
  if (!ok) for (const m of r.debugMessages ?? []) console.log(`       ${m}`);
});
console.log(`\n${faelle.length - fehlgeschlagen}/${faelle.length} passed (${matrix.length} from the permission table)`);
process.exit(fehlgeschlagen ? 1 : 0);
