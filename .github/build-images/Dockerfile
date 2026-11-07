# Wird nicht gebaut (#244): Dependabot liest Cloud-Build-Dateien nicht, aber
# Dockerfiles. Die Images hier sind dieselben wie in cloudbuild*.yaml;
# .github/workflows/pruefen.yml prüft das. Ein Update-PR von Dependabot ist darum
# rot, bis cloudbuild*.yaml nachzieht, und seine Terraform-Vorschau prüft das
# neue Image, bevor es nach main kommt.
FROM gcr.io/google.com/cloudsdktool/cloud-sdk:591.0.0-slim
