/**
 * Löscht Cloud Functions im Zustand FAILED, bevor das Backend deployt (#169).
 * Ein gescheitertes erstes Anlegen (etwa weil Rechte noch nicht wirken) lässt
 * eine Funktion ohne Trigger zurück, und jeder weitere Deploy scheitert daran
 * („Changing from an HTTPS function to a background triggered function“).
 * Eine solche Funktion lief nie; der Deploy legt sie neu an.
 *
 *   PROJEKT=<projekt> node tools/funktionen_aufraeumen.mjs
 *
 * Läuft in Cloud Build ohne Abhängigkeiten: das Token kommt vom Metadatenserver.
 */
const PROJEKT = process.env.PROJEKT;
if (!PROJEKT) throw new Error("PROJEKT setzen");

const { access_token: token } = await (await fetch(
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
  { headers: { "Metadata-Flavor": "Google" } })).json();
const api = (url, method = "GET") => fetch(url, { method, headers: { authorization: `Bearer ${token}` } })
  .then(async r => { if (!r.ok) throw new Error(`${r.status} ${url}: ${(await r.text()).slice(0, 300)}`); return r.json(); });

const { functions = [] } = await api(`https://cloudfunctions.googleapis.com/v2/projects/${PROJEKT}/locations/-/functions`);
const kaputt = functions.filter(f => f.state === "FAILED");
for (const f of kaputt) {
  console.log(`Lösche ${f.name} (FAILED)`);
  // Das Löschen ist eine Operation; der Deploy danach wartet nicht darauf, also hier abwarten.
  let op = await api(`https://cloudfunctions.googleapis.com/v2/${f.name}`, "DELETE");
  while (!op.done) {
    await new Promise(r => setTimeout(r, 5000));
    op = await api(`https://cloudfunctions.googleapis.com/v2/${op.name}`);
  }
  if (op.error) throw new Error(`Löschen von ${f.name}: ${op.error.message}`);
}
console.log(kaputt.length ? `${kaputt.length} gelöscht.` : "Keine Funktion im Zustand FAILED.");
