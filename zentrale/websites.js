import { api } from "./gcp.js";
import { deployments } from "./terraform.js";

/**
 * Die Websites (#76). Das Verzeichnis sind die Deployments <seite>-gcp in
 * Infrastructure Manager: Ihre Eingaben (infra/sites/<seite>/gcp.tfvars) nennen
 * Projekt, Künstler:in, Adresse und Branch. Die Zentrale liest und schreibt im
 * Projekt der Website mit den Rechten aus infra/gcp, nicht über die Firestore-Regeln.
 */

const REGION = "europe-west3";

export async function websites(ds) {
  ds ??= await deployments();
  return ds.filter(d => d.name.endsWith("-gcp") && d.eingaben.projekt_id && d.eingaben.kuenstler).map(d => {
    const e = d.eingaben;
    const seite = d.name.slice(0, -"-gcp".length);
    return {
      seite,
      projekt: e.projekt_id,
      kuenstler: e.kuenstler,
      datenbank: e.firestore_datenbank ?? "werkverzeichnis",
      adresse: e.seiten_url ?? "",
      trigger: `werkverzeichnis-${e.branch ?? "main"}`,
      deployments: ds.filter(x => x.name.startsWith(seite + "-")),
    };
  });
}

// --- Firestore über REST --------------------------------------------------------

const dokumente = w =>
  `https://firestore.googleapis.com/v1/projects/${w.projekt}/databases/${w.datenbank}/documents`;

function wert(v) {
  if (!v) return undefined;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("mapValue" in v) return felder(v.mapValue.fields);
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(wert);
  return undefined;
}
const felder = f => Object.fromEntries(Object.entries(f ?? {}).map(([k, v]) => [k, wert(v)]));

async function kuenstlerDokument(w) {
  const d = await api(`${dokumente(w)}/artists/${w.kuenstler}`).catch(f => {
    if (f.message.startsWith("404")) return null;
    throw f;
  });
  return d && felder(d.fields);
}

async function letzteVeroeffentlichung(w) {
  const antwort = await api(`${dokumente(w)}/artists/${w.kuenstler}:runQuery`, {
    structuredQuery: {
      from: [{ collectionId: "veroeffentlichungen" }],
      orderBy: [{ field: { fieldPath: "angefordert" }, direction: "DESCENDING" }],
      limit: 1,
    },
  });
  const d = antwort.find(a => a.document)?.document;
  return d && felder(d.fields);
}

/** Der letzte Build der Seite (Push oder Veröffentlichen). */
async function letzterBuild(w) {
  const { builds = [] } = await api(
    `https://cloudbuild.googleapis.com/v1/projects/${w.projekt}/locations/${REGION}/builds?pageSize=25`);
  const b = builds.find(b => b.substitutions?.TRIGGER_NAME === w.trigger);
  return b && {
    status: b.status, begonnen: b.createTime, beendet: b.finishTime, log: b.logUrl,
    commit: (b.substitutions?.SHORT_SHA ?? b.substitutions?.COMMIT_SHA ?? "").slice(0, 7),
  };
}

const oderFehler = p => p.catch(f => ({ fehler: f.message }));

/** Alles, was die Übersicht je Website zeigt; ein Fehler betrifft nur seinen Teil. */
export async function stand(w) {
  const [kuenstler, veroeffentlichung, build] = await Promise.all([
    oderFehler(kuenstlerDokument(w)), oderFehler(letzteVeroeffentlichung(w)), oderFehler(letzterBuild(w)),
  ]);
  return { ...w, kuenstlerDok: kuenstler, veroeffentlichung, build };
}

/**
 * Legt eine Veröffentlichung an wie die Verwaltung (Veroeffentlichen.jsx); die
 * Funktion veroeffentlichen startet daraufhin den Build.
 */
export async function veroeffentlichen(seite, email) {
  const w = (await websites()).find(x => x.seite === seite);
  if (!w) throw new Error(`Keine Website ${seite}`);
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  const name = `projects/${w.projekt}/databases/${w.datenbank}/documents/artists/${w.kuenstler}/veroeffentlichungen/${id}`;
  await api(`https://firestore.googleapis.com/v1/projects/${w.projekt}/databases/${w.datenbank}/documents:commit`, {
    writes: [{
      update: { name, fields: {
        von: { stringValue: email || "Zentrale" },
        status: { stringValue: "angefordert" },
        notiz: { stringValue: "aus der Zentrale" },
      } },
      updateTransforms: [{ fieldPath: "angefordert", setToServerValue: "REQUEST_TIME" }],
      currentDocument: { exists: false },
    }],
  });
}
