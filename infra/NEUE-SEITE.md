# Eine neue Website einrichten

Diese Anleitung läuft neben der Cloud Shell (#134). Die Befehle lassen sich mit
dem Knopf an jedem Block ins Terminal kopieren. Was erledigt ist, zeigt die
Zentrale unter *Neue Website einrichten*. Alles Weitere steht in
`infra/BOOTSTRAP.md`.

## Projekt anlegen

Eine Projekt-ID wählen, weltweit eindeutig, z. B. `horst-werkverzeichnis`, und
einen Kurznamen für die Seite, z. B. `horst`. Das Rechnungskonto heraussuchen:

```sh
gcloud billing accounts list
```

Dann das Projekt anlegen, mit dem Rechnungskonto verknüpfen und Terraform
erlauben, es zu verwalten:

```sh
infra/bootstrap.sh neue-seite werkverzeichnis-infra <seiten-projekt> <rechnungskonto> <seite>
```

Das Skript gibt am Ende die nächsten Schritte mit Links aus. Es schaltet auch
Cloud Build und Secret Manager ein, die die GitHub-Verbindung braucht.

## GitHub-Verbindung

Das neue Projekt auswählen:

<walkthrough-project-setup></walkthrough-project-setup>

Falls Cloud Build und Secret Manager noch aus sind (etwa bei einem Projekt, das
nicht mit `neue-seite` angelegt wurde):

<walkthrough-enable-apis apis="cloudbuild.googleapis.com,secretmanager.googleapis.com"></walkthrough-enable-apis>

oder über
[diesen Link](https://console.cloud.google.com/flows/enableapi?apiid=cloudbuild.googleapis.com,secretmanager.googleapis.com&project={{project-id}}).

Dann
<walkthrough-path-nav path="/cloud-build/repositories/2nd-gen?project={{project-id}}" title="Cloud Build → Repositories (2nd gen)">Cloud Build → Repositories (2nd gen)</walkthrough-path-nav>
öffnen (außerhalb der Console:
[in neuem Tab](https://console.cloud.google.com/cloud-build/repositories/2nd-gen?project={{project-id}}))
→ *Create host connection*:

- GitHub, Region europe-west3, Name **werkverzeichnis**;
- die App nur für das Repository installieren;
- das Repository nicht verknüpfen; das macht Terraform.

## Terraform-Eingaben

Die Zentrale (*Neue Website einrichten*) hat Links, die `gcp.tfvars` und
`cloudflare.tfvars` vorausgefüllt als neue Datei auf GitHub anlegen. Als PR
speichern; der Merge wendet Terraform an und fügt dem Projekt Firebase hinzu.

## Anmeldung mit Google

In der Firebase-Console (Project shortcuts → Authentication); das geht nur dort:

1. [Sign-in method](https://console.firebase.google.com/project/{{project-id}}/authentication/providers):
   *Get started*, dann Google aktivieren.
2. [Settings → Authorized domains](https://console.firebase.google.com/project/{{project-id}}/authentication/settings):
   *Add domain* für jede Adresse der Seite, ohne `https://`, z. B.
   `<pages-projekt>.pages.dev` und `main.<pages-projekt>.pages.dev`. Dieselben
   Adressen stehen in `web_adressen` in `gcp.tfvars` (dort mit `https://` und `/*`).

Eine Web-App in Firebase braucht es nicht; den Schlüssel legt Terraform an.

## Fertig

Die übrigen Schritte (Secrets, erstes Backend-Deploy, Künstler:in und erste
Admin) zeigt die Zentrale mit Haken, sobald sie erledigt sind.
