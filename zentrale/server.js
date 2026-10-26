import http from "node:http";
import { anwenden, deployments, holeLauf, laeufe, vorschau } from "./terraform.js";

/**
 * Die Zentrale (#27): Super-Admin-Aufgaben für alle Websites. Läuft in Cloud
 * Run hinter IAP; wer hier ankommt, hat IAP schon durchgelassen
 * (infra/zentrale). Bisher: Terraform je Deployment (#60).
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
  button { font: inherit; padding: .3rem .8rem; cursor: pointer }
  code { font-size: .85rem; word-break: break-all }
  form { display: inline }
  @media (max-width: 30rem) { .breit { display: none } }
</style>
<body>
<h1><a href="/">Zentrale</a></h1>
${inhalt}
</body>
</html>`;
}

function laufZeile(l) {
  return `<tr>
    <td><a href="/lauf/${l.id}">${l.befehl === "vorschau" ? "Vorschau" : "Anwenden"}</a></td>
    <td>${maskieren(l.ziel || "alle")}</td>
    <td>${ergebnis(l)}</td>
    <td class="klein">${zeit(l.begonnen)}<br>${maskieren(l.wer || "Merge")}</td>
  </tr>`;
}

async function uebersicht(email) {
  const [ds, ls] = await Promise.all([deployments(), laeufe()]);
  const zeilen = ds.map(d => `<tr>
    <td>${maskieren(d.name)}</td>
    <td class="${d.zustand === "ACTIVE" ? "" : "fehler"}">${maskieren(d.zustand)}${d.gesperrt ? " (gesperrt)" : ""}
      ${d.fehler ? `<br><span class="klein">${maskieren(d.fehler)}</span>` : ""}</td>
    <td class="klein breit">${zeit(d.geaendert)}</td>
    <td><form method="post" action="/vorschau"><input type="hidden" name="ziel" value="${maskieren(d.name)}">
      <button>Vorschau</button></form></td>
  </tr>`).join("");
  return seite("Übersicht", `
<p class="klein">Angemeldet als ${maskieren(email || "unbekannt")}.</p>
<h2>Terraform</h2>
<p>Die Vorschau zeigt, was Terraform am Deployment ändern würde, mit dem Code von <code>main</code>.
Angewendet wird erst nach einer Bestätigung.</p>
<table>
  <tr><th>Deployment</th><th>Zustand</th><th class="breit">zuletzt geändert</th><th></th></tr>
  ${zeilen}
</table>
<h2>Letzte Läufe</h2>
<table>
  <tr><th>Was</th><th>Deployment</th><th>Ergebnis</th><th>Wann, wer</th></tr>
  ${ls.map(laufZeile).join("")}
</table>`, { neuLaden: ls.some(l => l.laeuft) });
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
      Ja, ich will das in <strong>${maskieren(l.ziel)}</strong> löschen.</label>
  </div>` : ""}
  <button>Anwenden</button>
</form>
<p class="klein">Beim Anwenden rechnet Terraform den Plan neu; ist er nicht mehr derselbe, bricht es ab.</p>`;
}

async function laufSeite(id) {
  const l = await holeLauf(id);
  if (!l) return null;
  const titel = `${l.befehl === "vorschau" ? "Vorschau" : "Anwenden"}: ${l.ziel || "alle"}`;
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
  const pfad = new URL(anfrage.url, "http://x").pathname;
  try {
    let html;
    if (anfrage.method === "GET" && pfad === "/") html = await uebersicht(email);
    else if (anfrage.method === "GET" && pfad.startsWith("/lauf/")) html = await laufSeite(pfad.slice(6));
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
