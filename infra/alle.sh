#!/usr/bin/env bash
# Vorschau oder Anwenden für alle Deployments: jede Schicht jeder Seite unter
# infra/sites (sofern es ihre .tfvars gibt), dazu die Zentrale. Läuft in Cloud
# Build (cloudbuild-terraform.yaml, #58): Vorschau bei jedem PR, Anwenden nach
# dem Merge.
#
#   INFRA_PROJECT=<infra-projekt> infra/alle.sh preview|apply [<deployment>]
#
# Anwenden zeigt zuerst die Vorschau und lässt ein Deployment aus, dessen Plan
# etwas löscht oder ersetzt; das bleibt Handarbeit (apply.sh).
#
# Mit <deployment> (z. B. kutscher-gcp oder zentrale) nur dieses; so startet es
# die Zentrale (#60). Dann wendet es nur an, wenn der Plan den Fingerabdruck
# ERWARTET hat (der bestätigte Plan, plan.py), und löscht nur mit LOESCHEN=ja.
set -uo pipefail

befehl=${1:?preview or apply}
nur=${2:-}
hier=$(cd "$(dirname "$0")" && pwd)

ziele=()
for seite in "$hier"/sites/*/; do
  seite=$(basename "$seite")
  for schicht in gcp cloudflare; do
    [ -f "$hier/sites/$seite/$schicht.tfvars" ] && ziele+=("$schicht $seite")
  done
done
ziele+=("zentrale")

if [ -n "$nur" ]; then
  gefunden=""
  for ziel in "${ziele[@]}"; do
    read -r schicht seite <<<"$ziel"
    [ "${seite:+$seite-}$schicht" = "$nur" ] && gefunden=$ziel
  done
  [ -n "$gefunden" ] || { echo "!!! Kein Deployment $nur."; exit 1; }
  if [ "$befehl" = apply ] && [ -z "${ERWARTET:-}" ]; then
    echo "!!! Einzeln anwenden nur mit ERWARTET (Fingerabdruck des bestätigten Plans)."; exit 1
  fi
  ziele=("$gefunden")
else
  # Feste Namen, Bestätigungen und der Plan fürs Build-Ergebnis (plan.py) nur
  # für ein einzelnes Deployment.
  unset VORSCHAU ERWARTET LOESCHEN BUILDER_OUTPUT
fi

fehler=0
zusammenfassung=()   # je Deployment eine Zeile fürs Ende (#159)
for ziel in "${ziele[@]}"; do
  echo; echo "=== $ziel ==="
  read -r schicht seite <<<"$ziel"
  dname=${seite:+$seite-}$schicht   # wie das Deployment heißt, z. B. kutscher-gcp
  # shellcheck disable=SC2086 # Schicht und Seite als zwei Argumente
  ausgabe=$("$hier/apply.sh" preview $ziel | tee /dev/stderr)
  ergebnis=$?
  if [ $ergebnis -eq 3 ] && [ -n "$nur" ] && [ "${LOESCHEN:-}" = ja ]; then
    echo "Löschen bestätigt."
  elif [ $ergebnis -eq 3 ]; then
    echo "!!! $ziel löscht oder ersetzt etwas; nicht automatisch anwenden."
    zusammenfassung+=("$dname: ausgelassen, der Plan löscht oder ersetzt etwas")
    fehler=1; continue
  elif [ $ergebnis -eq 4 ]; then
    echo "!!! Der Plan für $ziel hat sich seit der Bestätigung geändert; nicht angewendet."
    zusammenfassung+=("$dname: nicht angewendet, der Plan hat sich seit der Bestätigung geändert")
    fehler=1; continue
  elif [ $ergebnis -ne 0 ]; then
    echo "!!! Vorschau für $ziel gescheitert."
    zusammenfassung+=("$dname: Vorschau gescheitert")
    fehler=1; continue
  fi
  # Ein leerer Plan ohne Importe und geänderte Ausgaben braucht kein Apply (#155); nur wenn
  # das Deployment nach einem gescheiterten Lauf FAILED steht, damit der Status
  # wieder stimmt.
  read -r schicht seite <<<"$ziel"
  if [ "$befehl" = apply ] && grep -q "^Plan: 0 anlegen, 0 ändern, 0 löschen" <<<"$ausgabe" \
    && ! grep -q "^Ausgaben ändern sich" <<<"$ausgabe" \
    && ! grep -q "^Importe:" <<<"$ausgabe" \
    && [ "$(gcloud infra-manager deployments describe "${seite:+$seite-}$schicht" --project="$INFRA_PROJECT" \
         --location="${INFRA_LOCATION:-europe-west3}" --format='value(state)' 2>/dev/null)" = ACTIVE ]; then
    echo "Nichts zu tun."
    continue
  fi
  if [ "$befehl" = apply ]; then
    # shellcheck disable=SC2086
    if "$hier/apply.sh" apply $ziel; then
      zusammenfassung+=("$dname: angewendet")
    else
      echo "!!! Anwenden für $ziel gescheitert."
      zusammenfassung+=("$dname: Anwenden gescheitert, Grund oben")
      fehler=1
    fi
  else
    zusammenfassung+=("$dname: Vorschau in Ordnung")
  fi
done

echo; echo "=== Zusammenfassung ==="
printf '%s\n' "${zusammenfassung[@]}"
exit $fehler
