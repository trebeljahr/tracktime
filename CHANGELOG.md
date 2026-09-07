# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `LICENSE` — GNU Affero General Public License v3.0 or later, the project's
  license (SPDX: `AGPL-3.0-or-later`).
- `README.md` — project overview, setup, and self-hosting documentation.
- `CONTRIBUTING.md` — contribution workflow, including the Developer
  Certificate of Origin 1.1 sign-off requirement (`git commit -s`).
- `SECURITY.md` — security policy: supported versions, the private disclosure
  route, and scope.
- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1.
- `TRADEMARK.md` — trademark policy covering the project name, logo, and
  domains, which the AGPL does not license.
- `ARCHITECTURE.md` — how the packages fit together, what a request does end
  to end, and how multi-device sync works.
- `ROADMAP.md` — what is wanted next, what is undecided, and what is
  deliberately out of scope.
- `GOVERNANCE.md` — who decides, how disagreements end, and what gets a pull
  request merged.
- `SUPPORT.md` — where to ask a question and what to expect for an answer.
- Issue templates (bug report, feature request, question) with a routing
  `config.yml`, and a pull request template, under `.github/`.
- `.github/CODEOWNERS` and `.github/dependabot.yml`.
- `.editorconfig` and `.gitattributes`.
- `.devcontainer/devcontainer.json` — a container definition for a
  ready-to-run development environment.

### Changed

- CI (`.github/workflows/build-and-deploy.yml`) now runs on pull requests as
  well as pushes to `main`. Pull requests reach `verify` (typecheck, build,
  server unit tests, client unit tests), `e2e` and `dco`; the image-build and
  Coolify deploy jobs stay push-only, each gated on its own
  `if: github.event_name == 'push'`.
- Security reports are routed by email rather than through GitHub private
  security advisories, which are not enabled on the repository.
