import http from "node:http";
import { anwenden, deployments, holeLauf, laeufe, vorschau } from "./terraform.js";
import { gescheitert, neuBauen, stand, websites } from "./websites.js";
import { personen, ROLLEN, rolleSetzen, superAdminSetzen, website } from "./personen.js";
import { anlegen, FELDER } from "./kuenstler.js";

/**
 * Die Zentrale (#27): Super-Admin-Aufgaben für alle Websites. Läuft in Cloud
 * Run hinter IAP; wer hier ankommt, hat IAP schon durchgelassen
 * (infra/zentrale). Bisher: Übersicht der Websites mit Veröffentlichen (#76),
 * Künstler:in, Personen und Super-Admins je Website (#80, #78), Terraform je
 * Deployment (#60).
 */

const maskieren = s => String(s ?? "").replace(/[&<>"']/g, z => `&#${z.charCodeAt(0)};`);

const zeit = t => t ? new Date(t).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" }) : "";

const STATUS = {
  QUEUED: "wartet", PENDING: "wartet", WORKING: "läuft", SUCCESS: "fertig", FAILURE: "gescheitert",
  INTERNAL_ERROR: "gescheitert", TIMEOUT: "Zeit überschritten", CANCELLED: "abgebrochen", EXPIRED: "verfallen",
};

const AKTIONEN = { create: "anlegen", update: "ändern", delete: "löschen", "delete+create": "ersetzen", "create+delete": "ersetzen" };

// Eine Vorschau, deren Plan etwas löscht, endet als FAILURE (alle.sh macht den
// PR-Check rot); hier ist das ein Ergebnis, kein Fehler.
function ergebnis(l) {
  if (l.befehl === "vorschau" && !l.laeuft && l.plan?.zaehler.delete > 0)
    return `<span class="fehler">löscht etwas</span>`;
  const text = STATUS[l.status] ?? maskieren(l.status);
  return l.erfolg || l.laeuft ? text : `<span class="fehler">${text}</span>`;
}

function seite(titel, inhalt, { neuLaden = false } = {}) {
  return `<!doctype html>
<html lang="de">
<meta charset="utf-8"><meta name="viewport" content="width=device-width">
${neuLaden ? '<meta http-equiv="refresh" content="5">' : ""}
<title>${maskieren(titel)} · Zentrale</title>
<style>
  body { font-family: Verdana, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; color: #222; line-height: 1.4 }
  h1 a { color: inherit; text-decoration: none }
  table { border-collapse: collapse; width: 100% }
  th, td { text-align: left; padding: .35rem .5rem; border-bottom: 1px solid #ddd; vertical-align: top }
  th { font-weight: normal; color: #666; font-size: .85rem }
  .klein { font-size: .85rem; color: #666 }
  .fehler { color: #a00 }
  .loeschen { background: #fde8e8; color: #900; font-weight: bold }
  .warnung { border: 2px solid #c00; background: #fff4f4; padding: .75rem 1rem; margin: 1rem 0 }
  button { font: inherit; padding: .3rem .8rem; cursor: pointer; white-space: nowrap; overflow-wrap: normal }
  code { font-size: .85rem; word-break: break-all }
  form { display: inline }
  .karte { border: 1px solid #ccc; border-radius: 6px; padding: 0 1rem .5rem; margin: 1.5rem 0 }
  .karte h2 { margin-bottom: 0 }
  .karte th { width: 11rem }
  .karte td { overflow-wrap: anywhere }
  input[type=email], input:not([type]) { font: inherit; padding: .25rem .4rem; width: min(18rem, 100%) }
  .felder th { width: 11rem }
  select { font: inherit; padding: .2rem }
  summary { cursor: pointer; color: #444; margin: .5rem 0 }
  @media (max-width: 30rem) {
    .karte th { width: auto }
    .personen tr { display: block; border-bottom: 1px solid #ddd; padding: .35rem 0 }
    .personen td { display: inline-block; border: 0; padding: .2rem .5rem .2rem 0 }
    .personen td:first-child { display: block }
  }
  @media (max-width: 30rem) { .breit { display: none } }
</style>
<body>
<h1><a href="/">Zentrale</a></h1>
${inhalt}
</body>
</html>`;
}

// kutscher-gcp → „kutscher · Google Cloud“
function anzeigeName(deployment) {
  if (!deployment) return "alle";
  if (deployment === "zentrale") return "Zentrale";
  const m = deployment.match(/^(.+)-(gcp|cloudflare)$/);
  return m ? `${m[1]} · ${m[2] === "gcp" ? "Google Cloud" : "Cloudflare"}` : deployment;
}

function laufZeile(l) {
  return `<tr>
    <td><a href="/lauf/${l.id}">${l.befehl === "vorschau" ? "Vorschau" : "Anwenden"}</a></td>
    <td>${maskieren(anzeigeName(l.ziel))}</td>
    <td>${ergebnis(l)}</td>
    <td class="klein">${zeit(l.begonnen)}<span class="breit"><br>${maskieren(l.wer || "Merge")}</span></td>
  </tr>`;
}

function deploymentZeile(d, name) {
  return `<tr>
    <td>${maskieren(name)}</td>
    <td>${d.zustand === "ACTIVE" ? "in Ordnung" : `<span class="fehler">${maskieren(d.zustand)}</span>`}${d.gesperrt ? " (gesperrt)" : ""}
      ${d.fehler ? `<br><span class="klein">${maskieren(d.fehler)}</span>` : ""}</td>
    <td class="klein breit">${zeit(d.geaendert)}</td>
    <td><form method="post" action="/vorschau"><input type="hidden" name="ziel" value="${maskieren(d.name)}">
      <button>Vorschau</button></form></td>
  </tr>`;
}

// Fehler aus gcp.js beginnen mit dem HTTP-Status; 403 heißt meist, dass
// zentrale@ im Projekt der Website (noch) keine Rechte hat (infra/gcp).
function fehlerText(t) {
  const grund = t.startsWith("403") ? "keine Berechtigung" : t.startsWith("404") ? "nicht gefunden" : t.slice(0, 60);
  return `<span class="fehler">nicht lesbar</span> <span class="klein">(${maskieren(grund)})</span>`;
}
const LAEUFT = ["angefordert", "wartet", "läuft"];
const BUILD_LAEUFT = ["PENDING", "QUEUED", "WORKING"];

function websiteKarte(w) {
  const k = w.kuenstlerDok;
  const titel = k?.titel ?? w.seite;
  const b = w.build, v = w.veroeffentlichung;
  const build = !b ? "noch keiner" : b.fehler ? fehlerText(b.fehler)
    : `${b.status === "SUCCESS" || BUILD_LAEUFT.includes(b.status) ? STATUS[b.status]
      : `<span class="fehler">${STATUS[b.status] ?? maskieren(b.status)}</span>`}
      · ${zeit(b.begonnen)}${b.commit ? ` · Commit ${maskieren(b.commit)}` : ""} · <a href="${maskieren(b.log)}">Log</a>`;
  const veroeffentlichung = !v ? "noch keine" : v.fehler ? fehlerText(v.fehler)
    : `${v.status === "fehler" ? `<span class="fehler">fehler</span>` : maskieren(v.status)}
      · ${zeit(v.angefordert)} · ${maskieren(v.von)}${v.notiz ? ` · „${maskieren(v.notiz)}“` : ""}
      ${v.meldung ? `<br><span class="klein fehler">${maskieren(v.meldung)}</span>` : ""}`;
  const schicht = d => d.name.endsWith("-gcp") ? "Google Cloud" : d.name.endsWith("-cloudflare") ? "Cloudflare" : d.name;
  return `<section class="karte">
  <h2>${maskieren(titel)}</h2>
  <p class="klein">${maskieren(w.seite)} · Projekt ${maskieren(w.projekt)}${k === null ? ` · <span class="fehler">kein Künstler:in-Dokument</span>`
    : k?.fehler ? ` · Künstler:in-Dokument ${fehlerText(k.fehler)}` : ""}</p>
  <p>${w.adresse ? `<a href="${maskieren(w.adresse)}">Website</a> · <a href="${maskieren(w.adresse.replace(/\/$/, ""))}/verwaltung/">Verwaltung</a> · ` : ""}<a href="/website/${encodeURIComponent(w.seite)}">Künstler:in und Personen</a></p>
  <table>
    <tr><th>Letzter Build</th><td>${build}</td></tr>
    <tr><th>Letzte Veröffentlichung</th><td>${veroeffentlichung}</td></tr>
  </table>
  ${gescheitert(w) ? `<form method="post" action="/neu-bauen" onsubmit="return confirm(${maskieren(JSON.stringify(`${titel} neu bauen?`))})">
    <input type="hidden" name="seite" value="${maskieren(w.seite)}">
    <p><button>Neu bauen</button> <span class="klein">mit dem Stand von jetzt; was sich ändert, zeigt die Verwaltung</span></p>
  </form>` : ""}
  <details>
    <summary>Infrastruktur (Terraform)</summary>
    <table>${w.deployments.map(d => deploymentZeile(d, schicht(d))).join("")}</table>
  </details>
</section>`;
}

async function uebersicht(email) {
  const [ds, ls] = await Promise.all([deployments(), laeufe(10)]);
  const ws = await Promise.all((await websites(ds)).map(stand));
  const zentrale = ds.filter(d => d.name === "zentrale");
  const laeuft = ls.some(l => l.laeuft) || ws.some(w => LAEUFT.includes(w.veroeffentlichung?.status)
    || BUILD_LAEUFT.includes(w.build?.status));
  return seite("Übersicht", `
<p class="klein">Angemeldet als ${maskieren(email || "unbekannt")}.</p>
${ws.map(websiteKarte).join("") || "<p>Noch keine Website.</p>"}
<h2>Zentrale</h2>
<p class="klein">Die Vorschau zeigt, was Terraform ändern würde, mit dem Code von <code>main</code>;
angewendet wird erst nach einer Bestätigung.</p>
<table>${zentrale.map(d => deploymentZeile(d, "Zentrale")).join("")}</table>
<h3>Letzte Terraform-Läufe</h3>
<table>
  <tr><th>Was</th><th>Deployment</th><th>Ergebnis</th><th>Wann, wer</th></tr>
  ${ls.map(laufZeile).join("")}
</table>`, { neuLaden: laeuft });
}

const rollenAuswahl = (gewaehlt = "editor") => `<select name="rolle">${Object.entries(ROLLEN)
  .map(([k, n]) => `<option value="${k}"${k === gewaehlt ? " selected" : ""}>${n}</option>`).join("")}</select>`;

async function websiteSeite(kennung) {
  const w = await website(kennung).catch(() => null);
  if (!w) return null;
  const [s, p] = await Promise.all([stand(w), personen(w)]);
  const titel = s.kuenstlerDok?.titel ?? w.seite;
  const formular = (aktion, felder, knopf, frage) => `<form method="post" action="${aktion}"${frage
    ? ` onsubmit="return confirm(${maskieren(JSON.stringify(frage))})"` : ""}>
    <input type="hidden" name="seite" value="${maskieren(w.seite)}">${felder}<button>${knopf}</button></form>`;
  const versteckt = (name, wert) => `<input type="hidden" name="${name}" value="${maskieren(wert)}">`;
  const angemeldet = email => {
    const k = p.konten.get(email);
    return !k ? `<span class="fehler">noch nie angemeldet</span>` : k.zuletzt ? `zuletzt ${zeit(k.zuletzt)}` : "angemeldet";
  };
  const personenZeilen = Object.entries(p.rollen).sort(([a], [b]) => a.localeCompare(b)).map(([email, rolle]) => `<tr>
    <td>${maskieren(email)}<br><span class="klein">${angemeldet(email)}</span></td>
    <td>${formular("/rolle", versteckt("email", email) + rollenAuswahl(rolle) + " ", "Ändern")}</td>
    <td>${formular("/rolle", versteckt("email", email) + versteckt("rolle", ""), "Entfernen", `${email} entfernen?`)}</td>
  </tr>`).join("");
  const k = s.kuenstlerDok;
  const kuenstler = k?.fehler ? `<p>${fehlerText(k.fehler)}</p>` : k ? `
<table class="felder">
  ${FELDER.map(([f, name]) => `<tr><th>${name}</th><td>${maskieren(k[f] ?? "")}</td></tr>`).join("")}
  <tr><th>Zuletzt geändert</th><td class="klein">${zeit(k.updatedAt)}</td></tr>
</table>
${w.adresse ? `<p class="klein">Bearbeiten in der Verwaltung unter
  <a href="${maskieren(w.adresse.replace(/\/$/, ""))}/verwaltung/einstellungen/">Einstellungen</a>.</p>` : ""}` : `
<p>Es gibt noch kein Künstler:in-Dokument; ohne es zeigt die Website nichts und niemand kann sich anmelden.
Name und erste Admin genügen, der Rest lässt sich später in der Verwaltung ändern.</p>
${formular("/kuenstler", `<p><label>Name<br><input name="titel" required maxlength="200" placeholder="z. B. Erika Beispiel"></label></p>
  <p><label>Erste Admin (Google-Konto)<br><input type="email" name="admin" required placeholder="name@gmail.com" autocomplete="off"></label></p>
  <details><summary>Weitere Felder (sonst „Werkverzeichnis von …“)</summary>
    ${FELDER.slice(1).map(([f, name]) => `<p><label>${name}<br><input name="${f}" maxlength="200"></label></p>`).join("")}
  </details>
  <p>`, "Anlegen")}`;
  const supers = [...p.konten].filter(([, k]) => k.superAdmin).map(([email]) => email).sort();
  const superZeilen = supers.map(email => `<tr>
    <td>${maskieren(email)}<br><span class="klein">${angemeldet(email)}</span></td>
    <td>${formular("/superadmin", versteckt("email", email) + versteckt("ja", ""), "Entziehen",
      `${email} die Rechte als Super-Admin entziehen?`)}</td>
  </tr>`).join("");
  return seite(titel, `
<h2>${maskieren(titel)}</h2>
<p class="klein">${maskieren(w.seite)} · Projekt ${maskieren(w.projekt)} · <a href="/">Übersicht</a></p>
<h3>Künstler:in</h3>
${kuenstler}
<h3>Personen</h3>
${p.gibtDokument ? `
<p class="klein">${Object.values(ROLLEN).join(" und ")}; Admins dürfen alles außer Super-Admins vergeben, Bearbeiter:innen nur Werke.
Die Anmeldung geht mit dem Google-Konto dieser Adresse.</p>
<table class="personen">${personenZeilen || `<tr><td>Noch niemand eingetragen.</td></tr>`}</table>
<h4>Eintragen</h4>
${formular("/rolle", `<input type="email" name="email" required placeholder="name@gmail.com" autocomplete="off"> ${rollenAuswahl()} `, "Eintragen")}`
    : `<p class="klein">Erst nach dem Künstler:in-Dokument.</p>`}
<h3>Super-Admins</h3>
<p class="klein">Dürfen auf dieser Website alles. Wirkt bei der nächsten Anmeldung der Person, spätestens nach einer Stunde.
Wer Super-Admin werden soll, muss sich vorher einmal angemeldet haben.</p>
<table class="personen">${superZeilen || `<tr><td>Niemand.</td></tr>`}</table>
<h4>Vergeben</h4>
${formular("/superadmin", `<input type="email" name="email" required placeholder="name@gmail.com" autocomplete="off">${versteckt("ja", "ja")} `,
    "Super-Admin machen", "Diese Person zur Super-Admin machen? Sie darf dann auf dieser Website alles.")}
`);
}

function planAnzeigen(l) {
  const p = l.plan;
  const z = p.zaehler;
  if (!p.aenderungen.length && !p.weitere) return `<p>Nichts zu ändern.</p>`;
  const zeilen = p.aenderungen.map(([aktion, adresse]) => {
    const loescht = aktion.includes("delete");
    return `<tr class="${loescht ? "loeschen" : ""}"><td>${maskieren(AKTIONEN[aktion] ?? aktion)}</td><td><code>${maskieren(adresse)}</code></td></tr>`;
  }).join("");
  return `
<p><strong>${z.create} anlegen, ${z.update} ändern, ${z.delete} löschen</strong></p>
<table>${zeilen}</table>
${p.weitere ? `<p class="klein">… und ${p.weitere} weitere, siehe <a href="${maskieren(l.log)}">Log</a>.</p>` : ""}`;
}

function bestaetigen(l) {
  const loescht = l.plan.zaehler.delete > 0;
  return `
<form method="post" action="/anwenden">
  <input type="hidden" name="vorschau" value="${l.id}">
  ${loescht ? `<div class="warnung">
    <p><strong>Dieser Plan löscht oder ersetzt ${l.plan.zaehler.delete} Ressource(n).</strong>
    Gelöschte Daten (Datenbank, Bilder, Secrets) sind dann weg.</p>
    <label><input type="checkbox" name="loeschen" value="ja" required>
      Ja, ich will das in <strong>${maskieren(anzeigeName(l.ziel))}</strong> löschen.</label>
  </div>` : ""}
  <button>Anwenden</button>
</form>
<p class="klein">Beim Anwenden rechnet Terraform den Plan neu; ist er nicht mehr derselbe, bricht es ab.</p>`;
}

async function laufSeite(id) {
  const l = await holeLauf(id);
  if (!l) return null;
  const titel = `${l.befehl === "vorschau" ? "Vorschau" : "Anwenden"}: ${anzeigeName(l.ziel)}`;
  let inhalt = `<h2>${maskieren(titel)}</h2>
<p><strong>${ergebnis(l)}</strong>
  <span class="klein">· begonnen ${zeit(l.begonnen)}${l.beendet ? `, beendet ${zeit(l.beendet)}` : ""}
  · ${maskieren(l.wer || "Merge")}${l.commit ? ` · Commit ${maskieren(l.commit)}` : ""}
  · <a href="${maskieren(l.log)}">Log</a></span></p>`;
  if (l.laeuft) inhalt += `<p>Das dauert ein bis drei Minuten; die Seite lädt sich neu.</p>`;
  else if (l.plan) {
    inhalt += planAnzeigen(l);
    const zuTun = l.plan.aenderungen.length || l.plan.weitere;
    if (l.befehl === "vorschau" && l.ziel && zuTun) inhalt += bestaetigen(l);
    else if (l.befehl === "anwenden" && !l.erfolg) inhalt += `<p class="fehler">Nicht angewendet oder gescheitert; Grund im Log.</p>`;
  } else if (!l.erfolg) inhalt += `<p class="fehler">Ohne Plan beendet; Grund im Log.</p>`;
  return seite(titel, inhalt, { neuLaden: l.laeuft });
}

async function formular(anfrage) {
  let text = "";
  for await (const teil of anfrage) {
    text += teil;
    if (text.length > 10_000) throw new Error("Formular zu groß");
  }
  return new URLSearchParams(text);
}

// Formulare nur von der Zentrale selbst; eine fremde Seite soll mit der
// IAP-Anmeldung nichts auslösen können.
function vonHier(anfrage) {
  const herkunft = anfrage.headers.origin;
  return anfrage.headers["sec-fetch-site"] === "same-origin"
    || (herkunft && new URL(herkunft).host === anfrage.headers.host);
}

const weiter = (antwort, ziel) => { antwort.writeHead(303, { location: ziel }); antwort.end(); };

http.createServer(async (anfrage, antwort) => {
  // IAP setzt die Adresse als „accounts.google.com:name@gmail.com“.
  const email = String(anfrage.headers["x-goog-authenticated-user-email"] ?? "")
    .replace(/^accounts\.google\.com:/, "");
  try {
    const pfad = new URL(anfrage.url, "http://x").pathname;
    let html;
    if (anfrage.method === "GET" && pfad === "/") html = await uebersicht(email);
    else if (anfrage.method === "GET" && pfad.startsWith("/lauf/")) html = await laufSeite(pfad.slice(6));
    else if (anfrage.method === "GET" && pfad.startsWith("/website/")) html = await websiteSeite(decodeURIComponent(pfad.slice(9)));
    else if (anfrage.method === "POST" && pfad === "/kuenstler") {
      if (!vonHier(anfrage)) throw new Error("Formular nicht von der Zentrale");
      const f = await formular(anfrage);
      const w = await website(f.get("seite") ?? "");
      await anlegen(w, Object.fromEntries(FELDER.map(([k]) => [k, f.get(k)])), f.get("admin"));
      return weiter(antwort, `/website/${encodeURIComponent(w.seite)}`);
    }
    else if (anfrage.method === "POST" && (pfad === "/rolle" || pfad === "/superadmin")) {
      if (!vonHier(anfrage)) throw new Error("Formular nicht von der Zentrale");
      const f = await formular(anfrage);
      const w = await website(f.get("seite") ?? "");
      if (pfad === "/rolle") await rolleSetzen(w, f.get("email"), f.get("rolle") || null);
      else await superAdminSetzen(w, f.get("email"), f.get("ja") === "ja");
      return weiter(antwort, `/website/${encodeURIComponent(w.seite)}`);
    }
    else if (anfrage.method === "POST" && pfad === "/neu-bauen") {
      if (!vonHier(anfrage)) throw new Error("Formular nicht von der Zentrale");
      await neuBauen((await formular(anfrage)).get("seite") ?? "", email);
      return weiter(antwort, "/");
    }
    else if (anfrage.method === "POST" && (pfad === "/vorschau" || pfad === "/anwenden")) {
      if (!vonHier(anfrage)) throw new Error("Formular nicht von der Zentrale");
      const f = await formular(anfrage);
      const id = pfad === "/vorschau"
        ? await vorschau(f.get("ziel") ?? "", email)
        : await anwenden(f.get("vorschau") ?? "", f.get("loeschen") === "ja", email);
      return weiter(antwort, `/lauf/${id}`);
    }
    if (!html) {
      antwort.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      return antwort.end(seite("Nicht gefunden", "<p>Nicht gefunden.</p>"));
    }
    antwort.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    antwort.end(html);
  } catch (fehler) {
    console.error(fehler);
    antwort.writeHead(500, { "content-type": "text/html; charset=utf-8" });
    antwort.end(seite("Fehler", `<p class="fehler">${maskieren(fehler.message)}</p><p><a href="/">Zurück</a></p>`));
  }
}).listen(process.env.PORT ?? 8080);
