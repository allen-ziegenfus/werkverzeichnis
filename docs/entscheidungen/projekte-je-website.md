# Ein Google-Cloud-Projekt je Website

Stand: 29.10.2026. Diskussion in #13 und #174, Umsetzung in #109–#112 und #137. Noch offen:
die Rücksprache mit den Verantwortlichen des Projekts (unten).

## Entscheidung

Jede Website, also jede Künstler:in, hat ihr eigenes Google-Cloud-Projekt mit
Firestore, Bucket, Funktionen und Trigger, dazu ein eigenes Pages-Projekt und
einen eigenen R2-Bucket bei Cloudflare. Gemeinsam sind das Repository, das
Infra-Projekt mit Infrastructure Manager und Zentrale und das Cloudflare-Konto.

## Warum

- **Übergabe:** Ein Werkverzeichnis lebt länger als unsere Betreuung. Ein
  Projekt lässt sich samt Daten an die Künstler:in, einen Nachlass oder eine
  Institution übertragen. In einem gemeinsamen Projekt ginge nur Export und
  Neuaufbau.
- **Abrechnung:** Jedes Projekt kann ein eigenes Rechnungskonto haben. In einem
  gemeinsamen Projekt lassen sich die Kosten je Künstler:in nur schätzen;
  Firestore lässt sich nicht nach Dokumenten aufteilen.
- **Trennung:** Ein Fehler in den Regeln oder ein kaputter Deploy trifft nur
  eine Seite. Wer Rechte in einem Projekt hat, sieht nur diese Seite.
  Kontingente sind nicht geteilt.

## Was es kostet

Jede neue Website braucht: Projekt, Rechnungskonto, APIs, Rechte, Firebase, die
Anmeldung mit Google (nur in der Console) und die GitHub-Verbindung. Ohne
Organisation darf ein Servicekonto keine Projekte anlegen. Darum beginnt eine
neue Seite mit einem Befehl in der Cloud Shell (`bootstrap.sh neue-seite`,
`infra/NEUE-SEITE.md`), und die Zentrale führt durch den Rest (`/neu`, #111).

Außerdem gibt es N von allem: Datenbanken, Funktionen, Trigger, Deployments in
Terraform. Gleichzeitige Läufe stören sich (#131); die Orchestrierung soll das
lösen (#152).

## Verworfen: ein Projekt für alle (A)

Das Datenmodell könnte es: `artists/{kuenstler}`, Rollen je Künstler:in, Pfade
`artists/<id>/` im Bucket. Eine neue Seite wäre ein Dokument, ein Pages-Projekt
und eine Zeile Konfiguration. Dagegen sprachen Übergabe, Abrechnung und Trennung
(oben).

## Wie andere Dienste Mandanten trennen

Die meisten SaaS-Dienste legen alle Kunden in eine gemeinsame Datenbank; die
Trennung steckt in der Anwendung, nicht in der Infrastruktur. Von locker bis streng:

| Muster | Wie | Beispiele |
|---|---|---|
| Gemeinsame Tabellen mit Schlüssel | jede Zeile mit Mandanten-Schlüssel; App oder Row-Level Security filtert | Shopify (`shop_id`), Slack, Notion |
| Tabellen je Mandant | gleiche Datenbank, eigene Tabellen | WordPress.com (Multisite: `wp_123_posts`, verteilt auf viele MySQL-Server) |
| Zellen (Pods) | Mandanten gruppiert auf mehrere gleiche Stacks | Shopify, später Slack und GitHub |
| Datenbank je Mandant | gleiche App, eigene Datenbank | B2B mit Vorgaben zur Datentrennung |
| Konto bzw. Projekt je Mandant | eigene Infrastruktur | selten; Compliance, Enterprise-Angebote (WordPress VIP) |

Sicherheit ohne harte Grenzen:
- Der Mandanten-Schlüssel wird an einer Stelle erzwungen, mit Tests, dass A nie
  Daten von B sieht.
- Zellen begrenzen, wen ein schlechter Deploy trifft.
- Statt eine Infrastruktur zu übergeben, gibt es einen Export.
- Die Abrechnung läuft über Zähler in der Anwendung, nicht über Rechnungskonten.

Unser Datenmodell ist schon das erste Muster: `artists/{kuenstler}` ist der
Schlüssel, die Firestore-Regeln sind die Row-Level Security, getestet mit
`tools/rules_test.mjs`. A entspricht damit dem Üblichen. B ist das strenge Ende,
das andere meist nur bei Compliance-Vorgaben wählen. Das stärkste Argument für
B bleibt die Übergabe; die ginge auch über einen guten Export, dazu auf Wunsch
der Umzug in ein eigenes Projekt.

## Erfahrungen mit der ersten neuen Seite (allenz)

Was beim Aufsetzen schiefging, waren vor allem Startprobleme. Die nächste Seite
sollte davon nichts mehr treffen:

- Namen fest im Code: Kutscher (#109), Buckets und R2 (#137);
- Voreinstellungen neuer Projekte, die anders sind als beim älteren Kutscher:
  - Bucket-Namen auf `.firebasestorage.app` (#137),
  - Firestore-Zugriff bei Enterprise-Datenbanken (#148),
  - Rechte der Dienst-Agenten für die Funktionen (#157),
  - Freigabe der Regeln (#153).

## Mittelweg, falls B zu aufwendig wird

Kleine Seiten liegen gemeinsam in einem Projekt, wie eine Zelle. Wer eigene
Abrechnung oder Übergabe braucht, bekommt ein eigenes oder zieht später um; dafür
braucht es einen vollständigen Export mit Daten, Originalen und Verlauf. Dafür müssen Funktionen und
Veröffentlichen mehrere Künstler:innen in einem Projekt können; Projekt und
Künstler:in sind heute schon Parameter.

## Offen

- **Mit den Verantwortlichen des Projekts:** Wie wichtig sind eigene Abrechnung und Übergabe für die
  Seiten, die geplant sind?
- Versionen je Seite, damit Änderungen im Code nicht alle Seiten zugleich
  treffen (#158).
