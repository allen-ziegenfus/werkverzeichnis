#!/usr/bin/env bash
# Der Teil, den Infrastructure Manager nicht selbst erledigen kann (BOOTSTRAP.md).
# Kann gefahrlos wiederholt werden: Alles wird geprüft oder ist idempotent.
#
#   infra/bootstrap.sh infra <infra-projekt> [rechnungskonto]
#       das Infra-Projekt, das Servicekonto von Infrastructure Manager und das
#       Cloudflare-Token für Terraform
#   infra/bootstrap.sh add-site <infra-projekt> <seiten-projekt>
#       erlaubt diesem Servicekonto, das Projekt einer Seite zu verwalten
#   infra/bootstrap.sh neue-seite <infra-projekt> <seiten-projekt> <rechnungskonto> [<seite>]
#       legt das Projekt einer neuen Seite an (mit dem eigenen Login: ein
#       Servicekonto darf ohne Organisation keine Projekte anlegen, #13),
#       verknüpft das Rechnungskonto, dann wie add-site; zeigt die nächsten Schritte
#   infra/bootstrap.sh zentrale <infra-projekt>
#       erlaubt ihm, die Zentrale im Infra-Projekt einzurichten, und legt das
#       Secret mit den Adressen an, die hinein dürfen
set -euo pipefail

befehl=${1:?infra, add-site, neue-seite or zentrale}
INFRA=${2:?infra project id}
KONTO=infra-manager@$INFRA.iam.gserviceaccount.com

# Ein neues Servicekonto ist in IAM erst nach einigen Sekunden überall bekannt;
# Bindungen an es bis dahin wiederholen.
wiederholen() {
  for i in 1 2 3 4 5 6; do
    "$@" && return
    echo "Noch einmal in 10 s ($i/6) …" >&2; sleep 10
  done
  "$@"
}

case $befehl in
infra)
  if ! gcloud projects describe "$INFRA" >/dev/null 2>&1; then
    gcloud projects create "$INFRA" --name="Werkverzeichnis Infra"
  fi
  if [ -n "${3:-}" ]; then
    gcloud billing projects link "$INFRA" --billing-account="$3"
  fi
  gcloud services enable --project="$INFRA" config.googleapis.com cloudbuild.googleapis.com \
    secretmanager.googleapis.com storage.googleapis.com iam.googleapis.com \
    cloudresourcemanager.googleapis.com serviceusage.googleapis.com

  gcloud iam service-accounts describe "$KONTO" --project="$INFRA" >/dev/null 2>&1 \
    || gcloud iam service-accounts create infra-manager --project="$INFRA" \
         --display-name="Infrastructure Manager (Terraform)"
  wiederholen gcloud projects add-iam-policy-binding "$INFRA" --member="serviceAccount:$KONTO" \
    --role=roles/config.agent --condition=None >/dev/null

  # Pages und R2 bearbeiten (später DNS); nur Terraform liest es, nie ein Build.
  gcloud secrets describe cloudflare-terraform-token --project="$INFRA" >/dev/null 2>&1 \
    || gcloud secrets create cloudflare-terraform-token --project="$INFRA" --replication-policy=automatic
  wiederholen gcloud secrets add-iam-policy-binding cloudflare-terraform-token --project="$INFRA" \
    --member="serviceAccount:$KONTO" --role=roles/secretmanager.secretAccessor --condition=None >/dev/null
  if [ -z "$(gcloud secrets versions list cloudflare-terraform-token --project="$INFRA" --filter=state=enabled --format='value(name)')" ]; then
    read -rsp "Cloudflare-Token für Terraform (leer = überspringen): " token; echo
    [ -n "$token" ] && printf %s "$token" | gcloud secrets versions add cloudflare-terraform-token \
      --project="$INFRA" --data-file=-
  fi
  echo "Infra project $INFRA ready."
  ;;

add-site)
  SEITE=${3:?site project id}
  gcloud services enable --project="$SEITE" serviceusage.googleapis.com cloudresourcemanager.googleapis.com
  for rolle in \
    roles/serviceusage.serviceUsageAdmin roles/resourcemanager.projectIamAdmin \
    roles/iam.serviceAccountAdmin roles/iam.serviceAccountUser roles/iam.workloadIdentityPoolAdmin \
    roles/storage.admin roles/secretmanager.admin roles/datastore.owner roles/pubsub.admin \
    roles/cloudbuild.builds.editor roles/cloudbuild.connectionAdmin roles/firebase.admin; do
    # Ein eben angelegtes Projekt ist ebenfalls erst nach einigen Sekunden überall bekannt.
    wiederholen gcloud projects add-iam-policy-binding "$SEITE" --member="serviceAccount:$KONTO" \
      --role="$rolle" --condition=None >/dev/null
  done
  echo "$KONTO may now manage $SEITE."
  ;;

neue-seite)
  SEITE=${3:?site project id}
  RECHNUNG=${4:?billing account id (gcloud billing accounts list)}
  NAME=${5:-$SEITE}
  if ! gcloud projects describe "$SEITE" >/dev/null 2>&1; then
    gcloud projects create "$SEITE" --name="Werkverzeichnis $NAME"
  fi
  gcloud billing projects link "$SEITE" --billing-account="$RECHNUNG" >/dev/null
  "$0" add-site "$INFRA" "$SEITE"
  # Damit die Zentrale den ersten Schritt schon vor Terraform sieht (#111).
  gcloud services enable --project="$SEITE" cloudbilling.googleapis.com
  for rolle in roles/browser roles/serviceusage.serviceUsageConsumer; do
    wiederholen gcloud projects add-iam-policy-binding "$SEITE" \
      --member="serviceAccount:zentrale@$INFRA.iam.gserviceaccount.com" --role="$rolle" --condition=None >/dev/null
  done
  cat <<WEITER

Projekt $SEITE ist angelegt. Weiter (BOOTSTRAP.md §3):

1. GitHub-Verbindung für Cloud Build (Name werkverzeichnis, Region europe-west3,
   die App nur für das Repository; das Repository nicht verknüpfen):
   https://console.cloud.google.com/cloud-build/repositories/2nd-gen?project=$SEITE

2. infra/sites/$NAME/ als PR, z. B. von infra/sites/kutscher kopiert, ohne die
   *-imports.tf. In gcp.tfvars:
     projekt_id        = "$SEITE"
     kuenstler         = "$NAME"
     github_verbindung = "werkverzeichnis"
     web_schluessel    = "web"   # Terraform legt den Schlüssel an
   Nach dem Merge wendet terraform-anwenden an (auch Firebase für das Projekt).

3. Danach in der Firebase-Console Authentication starten, Google aktivieren und
   unter Settings → Authorized domains die Adresse der Seite eintragen:
   https://console.firebase.google.com/project/$SEITE/authentication/providers

4. Die Secrets (BOOTSTRAP.md §4) und das erste Backend-Deploy (§5).
WEITER
  ;;

zentrale)
  for rolle in \
    roles/serviceusage.serviceUsageAdmin roles/run.admin roles/iap.admin \
    roles/iam.serviceAccountAdmin roles/iam.serviceAccountUser roles/resourcemanager.projectIamAdmin \
    roles/cloudbuild.builds.editor roles/cloudbuild.connectionAdmin; do
    wiederholen gcloud projects add-iam-policy-binding "$INFRA" --member="serviceAccount:$KONTO" \
      --role="$rolle" --condition=None >/dev/null
  done

  # Eine E-Mail-Adresse je Zeile; ändern mit einer neuen Version und apply.sh apply zentrale.
  gcloud secrets describe zentrale-zugang --project="$INFRA" >/dev/null 2>&1 \
    || gcloud secrets create zentrale-zugang --project="$INFRA" --replication-policy=automatic
  wiederholen gcloud secrets add-iam-policy-binding zentrale-zugang --project="$INFRA" \
    --member="serviceAccount:$KONTO" --role=roles/secretmanager.secretAccessor --condition=None >/dev/null
  if [ -z "$(gcloud secrets versions list zentrale-zugang --project="$INFRA" --filter=state=enabled --format='value(name)')" ]; then
    read -rp "Google-Adressen für die Zentrale, durch Leerzeichen getrennt: " adressen
    [ -n "$adressen" ] && printf '%s\n' $adressen | gcloud secrets versions add zentrale-zugang \
      --project="$INFRA" --data-file=-
  fi
  echo "$KONTO may now set up the Zentrale in $INFRA."
  ;;

*)
  echo "unknown command: $befehl" >&2; exit 1 ;;
esac
