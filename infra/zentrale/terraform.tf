# Terraform per PR (#58): Vorschau bei jedem PR, der infra/ ändert, Anwenden
# nach dem Merge (cloudbuild-terraform.yaml, infra/alle.sh). Die Builds laufen
# als terraform-ci@ und lassen Infrastructure Manager als infra-manager@
# arbeiten, wie apply.sh von Hand.

resource "google_service_account" "terraform" {
  account_id   = "terraform-ci"
  display_name = "Terraform per PR (Cloud Build)"
  depends_on   = [google_project_service.api]
}

resource "google_project_iam_member" "terraform" {
  for_each = toset([
    "roles/config.admin",             # Vorschauen und Deployments anlegen, Pläne lesen
    "roles/storage.admin",            # die Quellen in den Staging-Bucket von Infrastructure Manager laden
    "roles/cloudbuild.builds.viewer", # auf ältere Läufe warten (alle.sh, #131)
    "roles/logging.logWriter",
    "roles/serviceusage.serviceUsageConsumer",
  ])
  project = var.infra_projekt
  role    = each.key
  member  = "serviceAccount:${google_service_account.terraform.email}"
}

# Infrastructure Manager führt Terraform als infra-manager@ aus.
resource "google_service_account_iam_member" "terraform_als_infra_manager" {
  service_account_id = "projects/${var.infra_projekt}/serviceAccounts/infra-manager@${var.infra_projekt}.iam.gserviceaccount.com"
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.terraform.email}"
}

locals {
  terraform_dateien = ["infra/**", "cloudbuild-terraform.yaml"]
  # Doku und das Skript für die Einrichtung von Hand ändern keinen Plan (#155).
  terraform_ignoriert = ["infra/**/*.md", "infra/bootstrap.sh"]
}

# Die Vorschau führt Terraform-Code aus dem PR mit den Rechten von infra-manager@
# aus; bei PRs von außen erst nach einem Kommentar /gcbrun der Repo-Eigentümer:in.
resource "google_cloudbuild_trigger" "terraform_vorschau" {
  name            = "terraform-vorschau"
  description     = "Terraform-Vorschau aller Deployments (PR auf ${var.branch})"
  location        = var.region
  filename        = "cloudbuild-terraform.yaml"
  service_account = google_service_account.terraform.id
  included_files  = local.terraform_dateien
  ignored_files   = local.terraform_ignoriert

  repository_event_config {
    repository = google_cloudbuildv2_repository.repo.id
    pull_request {
      branch          = "^${var.branch}$"
      comment_control = "COMMENTS_ENABLED_FOR_EXTERNAL_CONTRIBUTORS_ONLY"
    }
  }

  substitutions = {
    _BEFEHL = "preview"
  }

  depends_on = [google_project_iam_member.terraform, google_service_account_iam_member.terraform_als_infra_manager]
}

resource "google_cloudbuild_trigger" "terraform_anwenden" {
  name            = "terraform-anwenden"
  description     = "Terraform anwenden, alle Deployments (Push auf ${var.branch})"
  location        = var.region
  filename        = "cloudbuild-terraform.yaml"
  service_account = google_service_account.terraform.id
  included_files  = local.terraform_dateien
  ignored_files   = local.terraform_ignoriert

  repository_event_config {
    repository = google_cloudbuildv2_repository.repo.id
    push {
      branch = "^${var.branch}$"
    }
  }

  substitutions = {
    _BEFEHL = "apply"
  }

  depends_on = [google_project_iam_member.terraform, google_service_account_iam_member.terraform_als_infra_manager]
}

# --- Aus der Zentrale (#60) -----------------------------------------------------
# Die Zentrale startet terraform-anwenden für ein einzelnes Deployment (als
# terraform-ci@, wie beim Merge). Den Plan liest sie aus dem Ergebnis des Builds
# (plan.py); selbst ändert sie nichts an Deployments.

resource "google_project_iam_member" "zentrale_terraform" {
  for_each = toset([
    "roles/cloudbuild.builds.editor", # den Trigger starten, Builds lesen
    "roles/config.viewer",            # Stand der Deployments
  ])
  project = var.infra_projekt
  role    = each.key
  member  = "serviceAccount:${google_service_account.zentrale.email}"
}

# Einen Trigger starten darf nur, wer als dessen Konto handeln darf.
resource "google_service_account_iam_member" "zentrale_als_terraform" {
  service_account_id = google_service_account.terraform.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.zentrale.email}"
}
