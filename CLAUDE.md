# Arbeitsregeln

Werkverzeichnis für Künstler:innen: statische Website (Astro 2, React, Tailwind 3)
mit einer Verwaltung unter `/verwaltung/`. Daten in Firestore; Veröffentlichen
baut in Cloud Build und deployt zu Cloudflare Pages. Überblick: `README.md`,
Infrastruktur: `infra/BOOTSTRAP.md`, Regeln fürs Review: `.macroscope/correctness/`.

## Ablauf

- Jede Änderung bekommt zuerst ein GitHub-Issue.
- Branch `<issue>-<thema>` von `main`, z. B. `25-veroeffentlichen-aufklappen`;
  bei Unter-Issues einer Gruppe vom Gruppen-Branch.
- Commit-Betreff endet mit `(#<issue>)`, dazu höchstens ein paar Zeilen Text.
- Änderungen gehen als PR nach `main` oder, bei Unter-Issues, in den
  Gruppen-Branch; nie direkt pushen, außer dem Anlegen des Gruppen-Branches
  und dem Merge von `main` hinein. Vor jedem Push fragen.
- Gruppen: Zusammengehörige Issues sind Unter-Issues eines Gruppen-Issues. Die
  Gruppe hat einen Branch `<gruppe>-<thema>` von `main` (`<gruppe>` ist die
  Nummer des Gruppen-Issues, z. B. `213-gleichzeitig-bearbeiten`); jedes
  Unter-Issue geht als eigener PR (eigene Beschreibung, eigene Screenshots) in
  den Gruppen-Branch. Ist die Gruppe fertig, geht der Gruppen-Branch als ein PR
  nach `main`, mit `Closes` je Issue und Links auf die Unter-PRs. Kleine
  Einzelstücke ohne Gruppe gehen weiter direkt nach `main`.
- `main` regelmäßig in den Gruppen-Branch mergen, nicht rebasen: Unter-PRs
  zielen auf ihn.
- Auf Gruppen-Branches läuft kein Cloud-Build-Trigger: Ein Merge dorthin
  deployt nichts, Unter-PRs bekommen aber auch keine Terraform-Vorschau.
  Änderungen unter `infra/` darum als Einzelstück direkt nach `main`.
- Keine gestapelten PRs: Branches werden nach dem Merge nicht gelöscht, ein PR
  auf einem anderen PR-Branch landet sonst dort statt in `main`. Gruppen-Branches
  sind keine PR-Branches; Unter-PRs zielen auf sie, solange die Gruppe offen ist.
- Die PR-Beschreibung sagt, was sich ändert, was geprüft ist und was nicht, und
  endet mit `Closes #<issue>` (Unter-PRs: `Teil von #<gruppe>`; `Closes` wirkt
  nur auf `main`).

## Vor dem PR

Fehler sollen vor dem Push auffallen, nicht erst im PR.

1. **Lokal prüfen** wie `.github/workflows/pruefen.yml`, je nach Änderung:
   - Website und Verwaltung: `TESTDATEN=tools/testdaten/katalog.json yarn data`,
     dann `SITE=https://example.org npx astro build`.
   - `firestore.rules`: `node tools/rules_test.mjs`.
   - `infra/`: `terraform fmt -check -recursive infra` und je Schicht
     `terraform init -backend=false && terraform validate`; Skripte mit `bash -n`.
   - Oberfläche: selbst ansehen und Screenshots (siehe unten).
2. **Review durch eine zweite Claude-Session**: Anfrage mit Branch, Issue und
   Schwerpunkten per SendMessage. Die Reviewer-Session liest nur
   (`git diff main...<branch>`, bei Unter-PRs gegen den Gruppen-Branch;
   `git show <branch>:<pfad>`), ändert, committet und
   postet nichts und wechselt keinen Branch; am besten in einem eigenen Worktree.
   Befunde mit Datei:Zeile, konkretem Fehlerfall und Vorschlag, Maßstab sind diese
   Datei und `.macroscope/correctness/`.
3. **Befunde beheben**, dann pushen und den PR öffnen.
4. **Macroscope** läuft nur von Hand und kostet je Prüfung mindestens 0,50 $,
   auch für einen kleinen Folge-Push. Darum einmal je PR nach `main` (bei
   Gruppen nur der Gruppen-PR), nach Rückfrage bei der Repo-Eigentümer:in, mit
   dem Kommentar `@macroscope-app review`. Seine Hinweise beheben, die Fixes
   durch das Review der zweiten Session, dann in einem Push ohne erneute
   Macroscope-Prüfung; im PR beantworten.

Änderungen unter `infra/` erst pushen, wenn kein Terraform-Lauf läuft (Vorschau
oder Anwenden); gleichzeitige Läufe sperren sich die Deployments.

## Sprache

Issues, Commits, PRs, Kommentare, Texte der Oberfläche und Bezeichner im Code
sind deutsch. Englisch nur, wo eine Bibliothek es vorgibt.

## Oberfläche

- PRs mit sichtbaren Änderungen bekommen Screenshots: hell, dunkel (Website)
  und Handybreite (390 px). Vorher selbst ansehen; Screenshots haben schon
  Fehler gefunden.
- Angemeldete Ansichten lassen sich ohne Google-Anmeldung nur mit nachgestellten
  Firebase-Modulen zeigen (Playwright `route()` auf `firebase_auth.js` und
  `firebase_firestore.js` im Dev-Server). Das im PR als Testdaten kennzeichnen.
- Die Website hat einen dunklen Modus (`dark:`-Klassen); die Verwaltung
  (`VerwaltungLayout.astro`) ist immer hell.
- Besucher, die nie angemeldet waren, laden kein Firebase; alles für
  Angemeldete wird mit `import()` nachgeladen.

## Bauen und testen

- `public/*.json` (Werke, Seiten, Einstellungen) ist nicht im Repo; `yarn data`
  liest sie aus Firestore und braucht Zugangsdaten. Ohne sie gehen
  `TESTDATEN=tools/testdaten/katalog.json yarn data`, dann
  `SITE=https://example.org npx astro build`; so prüft es auch jeder PR
  (`.github/workflows/pruefen.yml`). Die Testdaten überschreiben `public/*.json`.
- Firestore-Regeln: `node tools/rules_test.mjs` vor jeder Änderung an
  `firestore.rules`; `src/werkverzeichnis/permissions.js` muss zur Tabelle in
  den Regeln passen.

## Deployen und Zugangsdaten

- Regeln und Funktionen (`gcf/`) deployt nach dem Merge der Trigger
  `werkverzeichnis-backend-<branch>` (`cloudbuild-backend.yaml`), parallel zum
  Bau der Seite. Die Zentrale (`zentrale/`) deployt der Trigger `zentrale-main`
  im Infra-Projekt (`cloudbuild-zentrale.yaml`). Terraform (`infra/`): Jeder PR
  bekommt die Vorschau als Check (`terraform-vorschau`), der Merge wendet an
  (`terraform-anwenden`); Pläne mit Löschungen nicht. Die Zentrale startet
  denselben Trigger je Deployment, nach Bestätigung des Plans. Von Hand
  (`node tools/rules_deploy.mjs`, `infra/apply.sh`) nur durch die
  Repo-Eigentümer:in, nicht ohne ausdrückliche Bitte.
  Regeln und Seite gehen nach dem Merge gleichzeitig live, in beliebiger
  Reihenfolge. Darum neue Pflichten (z. B. ein Verlaufseintrag) zuerst nur
  erlauben, sodass alter und neuer Code mit alten und neuen Regeln gehen; erst
  ein späterer Merge nach `main` (nicht in derselben Gruppe) verlangt sie, wenn
  der Code, der sie erfüllt, schon live ist. Neue Schreibvorgänge kommen mit
  ihrer Erlaubnis; bis die Regeln live sind (wenige Minuten), kann neuer Code
  abgelehnt werden, das im PR sagen. Kein Deploy von Hand vor dem Merge.
- Keine Zugangsdaten, Tokens oder Schlüssel in Repo, Issues, PRs oder Logs.
- Die alte Website im Repo `allen-ziegenfus.github.io` (Branch `master`, GitHub
  Pages) ist noch live und wird nicht angefasst.
