# Datenmigrationen (#261)

Je Schritt eine Datei `NNN-name.js` (dreistellig, lückenlos), die

```js
export async function ausfuehren({ db, kuenstlerDok, bucket, log }) { … return "kurze Zusammenfassung"; }
```

exportiert. `gcf/migrieren.js` führt nach jedem Backend-Deploy die noch offenen
Schritte der Reihe nach aus; der Stand steht je Seite in
`artists/<k>/intern/schema`. Ein Schritt muss wiederholbar sein, auch zweimal gleichzeitig (Werte setzen
statt Zähler erhöhen): Scheitert er, beginnt ihn der nächste Deploy von vorn.
Keine langen synchronen Schleifen; große Mengen in Stapeln mit `await`, damit
der Lauf seine Sperre erneuern kann. Er läuft nach dem Deploy der Funktionen
und Regeln desselben Merges, darf sich also auf sie verlassen.

Seite, Regeln und Funktionen gehen nach dem Merge in beliebiger Reihenfolge
live. Ein Schritt darf darum nichts voraussetzen, was erst die neue Seite
schreibt, und alter Code muss mit den migrierten Daten weiterlaufen.

Von Hand nur durch die Eigentümer:in, siehe Kopf von `gcf/migrieren.js`.

Scheitert ein Schritt, ist der Backend-Build rot (Regeln und Funktionen sind
dann schon deployt). Nach dem Beheben: neuen Schritt oder Fix mergen, oder den
Build in Cloud Build wiederholen.

Nach einem Revert steht der Stand weiter vorn als die Dateien; der Runner tut
dann nichts. Ein Schritt darf darum auch alten Code nicht kaputt machen.
