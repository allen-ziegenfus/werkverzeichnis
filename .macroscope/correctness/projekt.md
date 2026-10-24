# Regeln des Werkverzeichnisses

Ein statisches Werkverzeichnis (Astro) mit einer Verwaltung für angemeldete
Bearbeiter:innen. Die Daten liegen in Firestore; Veröffentlichen baut die Seite
in Cloud Build neu und deployt sie zu Cloudflare Pages.

## Rechte

- `firestore.rules` setzt alle Rechte durch. Die Oberfläche (`darf()` aus
  `src/werkverzeichnis/permissions.js`) blendet nur aus, was man ohnehin nicht
  dürfte. Eine fehlende Prüfung in der Oberfläche ist kein Sicherheitsfehler,
  eine fehlende Prüfung in den Regeln schon.
- Die Rollentabelle steht doppelt: in `permissions.js` und oben in
  `firestore.rules`. Beide müssen übereinstimmen; `tools/rules_test.mjs` prüft
  jede Rolle gegen die Regeln. Eine Änderung an einer Stelle ohne die andere ist
  ein Fehler.

## Schreibvorgänge

- Werkgruppen, Seiten und das Künstler:in-Dokument (`artists/{a}`) setzen bei
  jedem Schreiben `updatedAt: serverTimestamp()`. Die Regeln verlangen es, und
  Veröffentlichen zählt daran die offenen Änderungen.
- Ein Werk wird nur in einer Transaktion geändert, die zugleich einen
  Verlaufseintrag (`history`) schreibt und `lastChange` setzt.
- Einstellungen und Rollen sind getrennte Berechtigungen; ein Schreibvorgang auf
  `artists/{a}` soll nur die Felder ändern, die zu seiner Seite gehören
  (`updateDoc`, nicht das ganze Dokument überschreiben).

## Reihenfolge beim Ausrollen

- Verlangt neuer Code etwas, das die bisherigen Regeln ablehnen (oder
  umgekehrt), müssen die Regeln vor dem Merge deployt werden
  (`node tools/rules_deploy.mjs`). Ein PR, der `firestore.rules` und Code
  zugleich ändert, sollte das in der Beschreibung sagen.

## Website und Verwaltung

- Besucher, die nie angemeldet waren, dürfen kein Firebase laden. Alles für
  Angemeldete (Werkzeugleiste, Anmelden) wird mit `import()` nachgeladen; ein
  statischer Import von Firebase in `Layout.astro` oder in Komponenten der
  öffentlichen Seiten ist ein Fehler.
- Jede Website gehört zu genau einer Künstler:in (`KUENSTLER` in
  `firebaseClient.js`). Künstler:innen anlegen gehört nicht in die Oberfläche.
- Die Verwaltung (`src/pages/verwaltung/`, `VerwaltungLayout.astro`) ist immer
  hell; die öffentliche Website hat einen dunklen Modus (`dark:`-Klassen).

## Sprache

- Texte der Oberfläche, Bezeichner, Kommentare, Commits und PRs sind deutsch.
  Englische Bezeichner nur, wo eine Bibliothek sie vorgibt.
- Schreibe deine Review-Kommentare, Zusammenfassungen und Vorschläge bitte auf
  Deutsch.
