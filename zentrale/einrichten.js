import { api, projekt as infraProjekt } from "./gcp.js";
import { deployments } from "./terraform.js";
import { letzterBuild, stand, websites } from "./websites.js";

/**
 * Die Schritte, bis eine neue Website läuft (#111, Option B in #13), und ob
 * jeder erledigt ist. Die Zentrale schaut jeden selbst nach; was sie (noch)
 * nicht lesen darf, ist „offen“, denn ihre Rechte im Projekt der Website kommen
 * erst mit bootstrap.sh neue-seite und infra/gcp.
 */

const REPO = "allen-ziegenfus/werkverzeichnis";
const SECRETS = ["cloudflare-pages-token", "r2-access-key-id", "r2-secret-access-key"];

// Die APIs dieser Aufrufe rechnen auf das Projekt der Website ab.
const lesen = (w, url) => api(url, undefined, { "x-goog-user-project": w.projekt });
const versuch = p => p.then(wert => ({ wert }), f => ({ fehler: f.message }));
const NICHT_LESBAR = "Noch nicht lesbar; kommt mit Terraform.";
const ZUSTAND = { ACTIVE: "angewendet", FAILED: "gescheitert", CREATING: "wird angelegt", UPDATING: "wird geändert" };
const BUILD = { SUCCESS: "fertig", FAILURE: "gescheitert", WORKING: "läuft", QUEUED: "wartet", PENDING: "wartet",
  INTERNAL_ERROR: "gescheitert", TIMEOUT: "Zeit überschritten", CANCELLED: "abgebrochen" };
const buildText = b => b?.status ? `Letzter Build: ${BUILD[b.status] ?? b.status}` : "";

/** Wie Firebase: Eine eingetragene Domain lässt auch ihre Subdomains zu (#144). */
const zugelassen = (host, domains = []) => domains.some(d => host === d || host.endsWith("." + d));

/** Die Eingaben einer neuen Website, als Vorlage für infra/sites/<seite>/. */
export function vorlagen(w, vorbild) {
  const e = vorbild?.eingaben ?? {};
  const pages = `werkverzeichnis-${w.seite}`;
  const gcp = `projekt_id          = "${w.projekt}"
kuenstler           = "${w.seite}"
github_verbindung   = "werkverzeichnis"
github_repo         = "${e.github_repo ?? REPO}"
branch              = "main"
seiten_url          = "${w.adresse}"
pages_projekt       = "${pages}"
cloudflare_konto_id = "${e.cloudflare_konto_id ?? "<konto-id>"}"
web_schluessel      = "web"
web_adressen        = ["${w.adresse.replace(/\/$/, "")}/*"]
bilder_bucket       = "werkverzeichnis-bilder-${w.seite}"
`;
  const cloudflare = `konto_id           = "${e.cloudflare_konto_id ?? "<konto-id>"}"
pages_projekt      = "${pages}"
produktions_branch = "main"
bilder_bucket      = "werkverzeichnis-bilder-${w.seite}"
`;
  const neu = (datei, inhalt) => `https://github.com/${REPO}/new/main?filename=${
    encodeURIComponent(`infra/sites/${w.seite}/${datei}`)}&value=${encodeURIComponent(inhalt)}`;
  return { gcp, cloudflare, gcpLink: neu("gcp.tfvars", gcp), cloudflareLink: neu("cloudflare.tfvars", cloudflare) };
}

/**
 * Die Schritte für eine Website: { titel, erledigt, text (HTML-frei), aktion }.
 * `aktion` ist { befehl } oder { link, text }; die Seite rendert sie.
 */
export async function einrichtung({ seite, projekt, adresse }) {
  const ds = await deployments();
  const bekannt = (await websites(ds)).find(x => x.seite === seite);
  const w = bekannt ?? {
    seite, projekt, kuenstler: seite, datenbank: "werkverzeichnis", adresse: adresse || `https://werkverzeichnis-${seite}.pages.dev`,
    trigger: "werkverzeichnis-main", backendTrigger: "werkverzeichnis-backend-main", deployments: [],
  };
  const p = w.projekt;
  const [projektInfo, rechnung, firebase, google, config, secrets, s, erfolg, backendErfolg] = await Promise.all([
    versuch(lesen(w, `https://cloudresourcemanager.googleapis.com/v3/projects/${p}`)),
    versuch(lesen(w, `https://cloudbilling.googleapis.com/v1/projects/${p}/billingInfo`)),
    versuch(lesen(w, `https://firebase.googleapis.com/v1beta1/projects/${p}`)),
    versuch(lesen(w, `https://identitytoolkit.googleapis.com/admin/v2/projects/${p}/defaultSupportedIdpConfigs/google.com`)),
    versuch(lesen(w, `https://identitytoolkit.googleapis.com/admin/v2/projects/${p}/config`)),
    Promise.all(SECRETS.map(n => versuch(lesen(w,
      `https://secretmanager.googleapis.com/v1/projects/${p}/secrets/${n}/versions?filter=${encodeURIComponent("state:ENABLED")}`)))),
    bekannt ? stand(w) : Promise.resolve({}),
    // Erledigt, sobald je ein Build geklappt hat, auch wenn gerade einer läuft (#146).
    bekannt ? letzterBuild(w, w.trigger, true).catch(() => null) : null,
    bekannt ? letzterBuild(w, w.backendTrigger, true).catch(() => null) : null,
  ]);
  const deployment = schicht => ds.find(d => d.name === `${seite}-${schicht}`);
  const vorbild = ds.find(d => d.name.endsWith("-gcp") && d.name !== `${seite}-gcp`);
  const v = vorlagen(w, vorbild);
  const host = (() => { try { return new URL(w.adresse).host; } catch { return ""; } })();
  const konsole = (pfad, text) => ({ link: `https://console.cloud.google.com/${pfad}${pfad.includes("?") ? "&" : "?"}project=${p}`, text });
  const firebaseKonsole = `https://console.firebase.google.com/project/${p}/authentication`;
  const fertig = b => b?.status === "SUCCESS";
  const tf = ["gcp", "cloudflare"].map(deployment);
  // Für die Anleitung zu den Cloudflare-Tokens (#166).
  const cf = tf[1]?.eingaben ?? {};
  const cfKonto = cf.konto_id ?? v.cloudflare.match(/konto_id *= "([^"]+)"/)?.[1];
  const r2Bucket = cf.bilder_bucket ?? `werkverzeichnis-bilder-${seite}`;

  return { w, vorlagen: v, schritte: [
    {
      titel: "Projekt und Rechnungskonto",
      erledigt: projektInfo.wert?.state === "ACTIVE" && rechnung.wert?.billingEnabled === true,
      text: projektInfo.fehler ? "Projekt nicht lesbar (gibt es noch nicht, oder die Zentrale hat dort noch keine Rechte)."
        : rechnung.wert?.billingEnabled === false ? "Kein Rechnungskonto verknüpft." : "",
      aktion: { befehl: `infra/bootstrap.sh neue-seite ${infraProjekt} ${p} <rechnungskonto> ${seite}` },
    },
    {
      titel: "Terraform: infra/sites/" + seite,
      erledigt: tf.every(d => d?.zustand === "ACTIVE"),
      text: tf.map((d, i) => `${["Google Cloud", "Cloudflare"][i]}: ${d ? (ZUSTAND[d.zustand] ?? d.zustand) + (d.fehler ? ` (${d.fehler})` : "") : "noch nicht angewendet"}`).join(" · "),
      aktion: { links: [{ link: v.gcpLink, text: "gcp.tfvars anlegen" }, { link: v.cloudflareLink, text: "cloudflare.tfvars anlegen" }],
        hinweis: "Als PR; der Merge wendet an. Ohne GitHub-Verbindung aus Terraform (#112) vorher in der Konsole anlegen:",
        weitere: [konsole("cloud-build/repositories/2nd-gen", "GitHub-Verbindung")] },
    },
    {
      titel: "Firebase",
      erledigt: !!firebase.wert?.projectId,
      text: firebase.fehler ? NICHT_LESBAR : "",
    },
    {
      titel: "Anmeldung mit Google",
      erledigt: google.wert?.enabled === true && !!host && zugelassen(host, config.wert?.authorizedDomains),
      text: google.fehler?.startsWith("404") ? "Google ist nicht aktiviert." : google.fehler ? NICHT_LESBAR : [google.wert?.enabled ? "" : "Google ist nicht aktiviert.",
        host && config.wert && !zugelassen(host, config.wert.authorizedDomains) ? `${host} fehlt bei den Authorized domains.` : ""]
        .filter(Boolean).join(" "),
      aktion: { link: `${firebaseKonsole}/providers`, text: "Authentication → Google aktivieren, Settings → Authorized domains" },
    },
    {
      titel: "Secrets",
      erledigt: secrets.every(x => (x.wert?.versions ?? []).length > 0),
      text: secrets.some(x => x.fehler) ? NICHT_LESBAR
        : SECRETS.filter((_, i) => !(secrets[i].wert?.versions ?? []).length).map(n => `${n} hat keinen Wert`).join(", "),
      aktion: {
        hinweis: "Zwei Tokens in Cloudflare (der Wert erscheint nur einmal; Seite offen lassen, bis er eingetragen ist): "
          + "1. Account API Token → Custom token, eine Policy: Entire account → „Pages Write“ (früher „Cloudflare Pages · Edit“) → cloudflare-pages-token. "
          + `2. R2-Token, „Object Read & Write“, nur Bucket ${r2Bucket}; davon Access Key ID → r2-access-key-id, `
          + "Secret Access Key → r2-secret-access-key. Dann der Befehl (fragt die drei Werte nacheinander). "
          + "Ohne Handarbeit: seiten_projekt in cloudflare.tfvars (#143).",
        links: cfKonto ? [
          { link: `https://dash.cloudflare.com/${cfKonto}/api-tokens`, text: "Account API Tokens" },
          { link: `https://dash.cloudflare.com/${cfKonto}/r2/api-tokens`, text: "R2-Tokens" },
        ] : undefined,
        befehl: `P=${p}; for s in r2-access-key-id r2-secret-access-key cloudflare-pages-token; do read -rsp "$s: " T; echo; `
          + `printf %s "$T" | gcloud secrets versions add $s --project=$P --data-file=-; done; unset T`,
      },
    },
    {
      titel: "Regeln und Funktionen",
      erledigt: fertig(s.backend) || !!backendErfolg,
      text: buildText(s.backend) || "Noch kein Build.",
      aktion: konsole("cloud-build/triggers;region=europe-west3", `${w.backendTrigger} einmal ausführen`),
    },
    {
      titel: "Künstler:in und erste Admin",
      erledigt: !!s.kuenstlerDok && !s.kuenstlerDok.fehler && Object.values(s.kuenstlerDok.roles ?? {}).includes("admin"),
      text: bekannt ? "" : "Sobald Terraform angewendet ist, hier in der Zentrale bei der Website.",
      aktion: bekannt ? { link: `/website/${encodeURIComponent(seite)}`, text: "Anlegen", intern: true } : undefined,
    },
    {
      titel: "Erster Build",
      erledigt: fertig(s.build) || !!erfolg,
      text: buildText(s.build) || "Noch kein Build; der Push nach dem Merge oder Veröffentlichen baut.",
      aktion: w.adresse ? { link: w.adresse, text: "Website öffnen" } : undefined,
    },
  ] };
}
