import { api, ort, projekt } from "./gcp.js";

/**
 * Terraform aus der Zentrale (#60). Die Zentrale führt Terraform nicht selbst
 * aus: Sie startet den Trigger terraform-anwenden (cloudbuild-terraform.yaml,
 * infra/alle.sh) für ein einzelnes Deployment, mit dem Code von main, und liest
 * den Plan aus dem Ergebnis des Builds (infra/plan.py).
 */

const TRIGGER = "terraform-anwenden";
// Zum Ausprobieren eines Branches lokal TERRAFORM_BRANCH setzen.
const BRANCH = process.env.TERRAFORM_BRANCH ?? "main";
const eltern = `projects/${projekt}/locations/${ort}`;
const config = `https://config.googleapis.com/v1/${eltern}`;
const build = `https://cloudbuild.googleapis.com/v1/${eltern}`;

/** Die Deployments in Infrastructure Manager, z. B. kutscher-gcp, zentrale. */
export async function deployments() {
  const { deployments = [] } = await api(`${config}/deployments`);
  return deployments.map(d => ({
    name: d.name.split("/").pop(),
    zustand: d.state,
    gesperrt: d.lockState && d.lockState !== "UNLOCKED",
    geaendert: d.updateTime,
    fehler: d.errorCode && d.errorCode !== "ERROR_CODE_UNSPECIFIED" ? d.errorCode : "",
    // Die Eingaben aus sites/<seite>/<schicht>.tfvars, z. B. projekt_id.
    eingaben: Object.fromEntries(Object.entries(d.terraformBlueprint?.inputValues ?? {})
      .map(([k, v]) => [k, v.inputValue])),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

let triggerId;
async function trigger() {
  triggerId ??= (await api(`${build}/triggers/${TRIGGER}`)).id;
  return triggerId;
}

/** Ein Build des Triggers, so wie die Zentrale ihn zeigt. */
function lauf(b) {
  const s = b.substitutions ?? {};
  let plan = null;
  try {
    const ausgabe = b.results?.buildStepOutputs?.[0];
    if (ausgabe) plan = JSON.parse(Buffer.from(ausgabe, "base64").toString());
  } catch { /* kein Plan, z. B. Vorschau gescheitert */ }
  return {
    id: b.id,
    befehl: s._BEFEHL === "preview" ? "vorschau" : "anwenden",
    ziel: s._ZIEL || "",
    wer: s._WER || "",
    status: b.status,
    laeuft: ["PENDING", "QUEUED", "WORKING"].includes(b.status),
    erfolg: b.status === "SUCCESS",
    begonnen: b.createTime,
    beendet: b.finishTime,
    log: b.logUrl,
    commit: (b.sourceProvenance?.resolvedConnectedRepository?.revision ?? s.COMMIT_SHA ?? "").slice(0, 7),
    plan,
  };
}

/** Die letzten Läufe des Triggers, aus der Zentrale und nach jedem Merge. */
export async function laeufe(anzahl = 15) {
  const filter = encodeURIComponent(`trigger_id="${await trigger()}"`);
  const { builds = [] } = await api(`${build}/builds?pageSize=${anzahl}&filter=${filter}`);
  return builds.map(lauf);
}

export async function holeLauf(id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const b = await api(`${build}/builds/${id}`).catch(() => null);
  return b && b.buildTriggerId === await trigger() ? lauf(b) : null;
}

async function starten(substitutionen) {
  const antwort = await api(`${build}/triggers/${await trigger()}:run`, {
    projectId: projekt,
    triggerId: await trigger(),
    source: { branchName: BRANCH, substitutions: substitutionen },
  });
  return antwort.metadata.build.id;
}

async function pruefeZiel(ziel) {
  if (!(await deployments()).some(d => d.name === ziel)) throw new Error(`Kein Deployment ${ziel}`);
}

/** Startet die Vorschau eines Deployments; gibt die Build-ID zurück. */
export async function vorschau(ziel, wer) {
  await pruefeZiel(ziel);
  const zeit = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return starten({ _BEFEHL: "preview", _ZIEL: ziel, _VORSCHAU: `${ziel}-z${zeit}`, _WER: wer });
}

/**
 * Wendet den Plan einer erfolgreichen Vorschau an. Der Build rechnet den Plan
 * neu und bricht ab, wenn er nicht mehr derselbe ist (Fingerabdruck); löschen
 * darf er nur, wenn die Bestätigung dafür mitkommt.
 */
export async function anwenden(vorschauId, loeschenBestaetigt, wer) {
  const v = await holeLauf(vorschauId);
  if (!v || v.befehl !== "vorschau" || !v.plan || !v.ziel) throw new Error("Keine Vorschau mit Plan");
  await pruefeZiel(v.ziel);
  const loescht = v.plan.zaehler.delete > 0;
  if (loescht && !loeschenBestaetigt) throw new Error("Der Plan löscht etwas; das muss eigens bestätigt werden");
  return starten({
    _BEFEHL: "apply", _ZIEL: v.ziel, _ERWARTET: v.plan.fingerabdruck,
    _LOESCHEN: loescht ? "ja" : "", _WER: wer,
  });
}
