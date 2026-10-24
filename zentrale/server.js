import http from "node:http";

/**
 * Die Zentrale (#27): Super-Admin-Aufgaben für alle Websites. Läuft in Cloud
 * Run hinter IAP; wer hier ankommt, hat IAP schon durchgelassen
 * (infra/zentrale). Bisher nur das Gerüst.
 */

const maskieren = s => String(s).replace(/[&<>"']/g, z => `&#${z.charCodeAt(0)};`);

http.createServer((anfrage, antwort) => {
  // IAP setzt die Adresse als „accounts.google.com:name@gmail.com“.
  const email = String(anfrage.headers["x-goog-authenticated-user-email"] ?? "")
    .replace(/^accounts\.google\.com:/, "");
  antwort.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  antwort.end(`<!doctype html>
<html lang="de">
<meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Zentrale</title>
<body style="font-family: Verdana, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem">
  <h1>Zentrale</h1>
  <p>Angemeldet als ${maskieren(email || "unbekannt")}.</p>
  <p>Hier entsteht die Verwaltung aller Websites des Werkverzeichnisses.</p>
</body>
</html>`);
}).listen(process.env.PORT ?? 8080);
