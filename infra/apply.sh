#!/usr/bin/env bash
# Führt eine Schicht einer Seite über Infrastructure Manager aus, das den
# Terraform-State hält.
#
#   INFRA_PROJECT=<infra-projekt> infra/apply.sh preview|apply gcp|cloudflare <seite>
#   INFRA_PROJECT=<infra-projekt> infra/apply.sh preview|apply zentrale
#
# Das Deployment heißt <seite>-<schicht>, für die Zentrale (eine für alle Seiten)
# nur zentrale. sites/<seite>/<schicht>.tfvars sind die
# Eingaben; sites/<seite>/<schicht>-imports.tf kommt, falls vorhanden, in die
# Kopie der Schicht für diese Seite (einmalige Importe dessen, was es vor
# Terraform schon gab). VORSCHAU gibt der Vorschau einen festen Namen (die
# Zentrale liest sie danach, #60).
set -euo pipefail

befehl=${1:?preview or apply}
schicht=${2:?gcp, cloudflare or zentrale}
if [ "$schicht" = zentrale ]; then seite=""; else seite=${3:?site, a directory in infra/sites}; fi
: "${INFRA_PROJECT:?set INFRA_PROJECT}"
ORT=${INFRA_LOCATION:-europe-west3}

hier=$(cd "$(dirname "$0")" && pwd)
eltern=projects/$INFRA_PROJECT/locations/$ORT
name=${seite:+$seite-}$schicht
deployment=$eltern/deployments/$name

arbeit=$(mktemp -d)
trap 'rm -r "${arbeit:?}"' EXIT
mkdir "$arbeit/src"
cp "$hier/$schicht"/*.tf "$arbeit/src/"
if [ -n "$seite" ]; then
  [ -f "$hier/sites/$seite/$schicht-imports.tf" ] && cp "$hier/sites/$seite/$schicht-imports.tf" "$arbeit/src/"
  cp "$hier/sites/$seite/$schicht.tfvars" "$arbeit/eingaben.tfvars"
fi
[ "$schicht" != gcp ] && echo "infra_projekt = \"$INFRA_PROJECT\"" >> "$arbeit/eingaben.tfvars"

# gcloud braucht ein Projekt für die API-Aufrufe, auch bei vollen Ressourcennamen.
export CLOUDSDK_CORE_PROJECT=$INFRA_PROJECT

argumente=(
  --service-account="projects/$INFRA_PROJECT/serviceAccounts/infra-manager@$INFRA_PROJECT.iam.gserviceaccount.com"
  --local-source="$arbeit/src"
  --inputs-file="$arbeit/eingaben.tfvars"
  --tf-version-constraint=1.5.7
)

case $befehl in
preview)
  vorschau=$eltern/previews/${VORSCHAU:-$name-$(date +%Y%m%d-%H%M%S)}
  if gcloud infra-manager deployments describe "$deployment" >/dev/null 2>&1; then
    argumente+=(--deployment="$deployment")
  fi
  gcloud infra-manager previews create "$vorschau" "${argumente[@]}" >/dev/null
  # Kurz: was angelegt, geändert, gelöscht würde (Exit 3, wenn etwas gelöscht
  # würde). Der ganze Plan steht im Cloud-Build-Log der Vorschau.
  python3 "$hier/plan.py" "$vorschau"
  ;;
apply)
  gcloud infra-manager deployments apply "$deployment" "${argumente[@]}"
  ;;
*)
  echo "unknown command: $befehl" >&2; exit 1 ;;
esac
