# Läuft in Infrastructure Manager, das Terraform bis 1.5.x anbietet.
terraform {
  required_version = ">= 1.5, < 1.6"
  required_providers {
    google      = { source = "hashicorp/google", version = "~> 7.0" }
    google-beta = { source = "hashicorp/google-beta", version = "~> 7.0" }
  }
}

provider "google" {
  project = var.infra_projekt
  region  = var.region
}

provider "google-beta" {
  project = var.infra_projekt
  region  = var.region
}
