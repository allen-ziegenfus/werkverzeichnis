import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * Google-APIs als Konto der Zentrale (zentrale@). In Cloud Run kommt das Token
 * vom Metadatenserver, lokal von gcloud (eigene Anmeldung).
 */

const METADATEN = "http://metadata.google.internal/computeMetadata/v1";
let token = { wert: "", bis: 0 };

async function metadaten(pfad) {
  const r = await fetch(METADATEN + pfad, { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(1000) });
  if (!r.ok) throw new Error(`Metadaten ${pfad}: ${r.status}`);
  return r;
}

async function holeToken() {
  if (token.bis > Date.now() + 60_000) return token.wert;
  try {
    const t = await (await metadaten("/instance/service-accounts/default/token")).json();
    token = { wert: t.access_token, bis: Date.now() + t.expires_in * 1000 };
  } catch {
    const { stdout } = await promisify(execFile)("gcloud", ["auth", "application-default", "print-access-token"]);
    token = { wert: stdout.trim(), bis: Date.now() + 10 * 60_000 };
  }
  return token.wert;
}

export const ort = process.env.INFRA_LOCATION ?? "europe-west3";
export const projekt = process.env.INFRA_PROJECT
  ?? await metadaten("/project/project-id").then(r => r.text()).catch(() => {
    throw new Error("INFRA_PROJECT setzen (außerhalb von Cloud Run)");
  });

export async function api(url, daten) {
  const r = await fetch(url, {
    method: daten ? "POST" : "GET",
    headers: { authorization: `Bearer ${await holeToken()}`, "content-type": "application/json" },
    body: daten && JSON.stringify(daten),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${url.replace(/\?.*/, "")}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}
