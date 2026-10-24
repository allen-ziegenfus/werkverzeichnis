#!/usr/bin/env bash
# Baut die App aus zentrale/ und deployt sie in den Cloud-Run-Dienst, den
# Terraform angelegt hat (apply.sh apply zentrale). IAP und Zugang bleiben dabei
# unverändert.
#
#   INFRA_PROJECT=<infra-projekt> infra/zentrale/deploy.sh
set -euo pipefail
: "${INFRA_PROJECT:?set INFRA_PROJECT}"
ORT=${INFRA_LOCATION:-europe-west3}
hier=$(cd "$(dirname "$0")" && pwd)
gcloud run deploy zentrale \
  --project="$INFRA_PROJECT" --region="$ORT" \
  --source="$hier/../../zentrale" \
  --build-service-account="projects/$INFRA_PROJECT/serviceAccounts/zentrale-bauen@$INFRA_PROJECT.iam.gserviceaccount.com" \
  --quiet
