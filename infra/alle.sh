#!/usr/bin/env bash
# Vorschau oder Anwenden für alle Deployments: jede Schicht jeder Seite unter
# infra/sites (sofern es ihre .tfvars gibt), dazu die Zentrale. Läuft in Cloud
# Build (cloudbuild-terraform.yaml, #58): Vorschau bei jedem PR, Anwenden nach
# dem Merge.
#
#   INFRA_PROJECT=<infra-projekt> infra/alle.sh preview|apply
#
# Anwenden zeigt zuerst die Vorschau und lässt ein Deployment aus, dessen Plan
# etwas löscht oder ersetzt; das bleibt Handarbeit (apply.sh).
set -uo pipefail

befehl=${1:?preview or apply}
hier=$(cd "$(dirname "$0")" && pwd)

ziele=()
for seite in "$hier"/sites/*/; do
  seite=$(basename "$seite")
  for schicht in gcp cloudflare; do
    [ -f "$hier/sites/$seite/$schicht.tfvars" ] && ziele+=("$schicht $seite")
  done
done
ziele+=("zentrale")

fehler=0
for ziel in "${ziele[@]}"; do
  echo; echo "=== $ziel ==="
  # shellcheck disable=SC2086 # Schicht und Seite als zwei Argumente
  "$hier/apply.sh" preview $ziel
  ergebnis=$?
  if [ $ergebnis -eq 3 ]; then
    echo "!!! $ziel löscht oder ersetzt etwas; nicht automatisch anwenden."
    fehler=1; continue
  elif [ $ergebnis -ne 0 ]; then
    echo "!!! Vorschau für $ziel gescheitert."
    fehler=1; continue
  fi
  if [ "$befehl" = apply ]; then
    # shellcheck disable=SC2086
    "$hier/apply.sh" apply $ziel || { echo "!!! Anwenden für $ziel gescheitert."; fehler=1; }
  fi
done
exit $fehler
