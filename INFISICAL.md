# Infisical CLI Guide: Sharing & Syncing Environment Variables (`.env`)

This guide covers how to set up, sync, and share environment variables and secrets securely across your team using the [Infisical CLI](https://infisical.com/docs/cli/usage) for `corelink_server`.

---

## 📑 Table of Contents
1. [Why Use Infisical?](#why-use-infisical)
2. [Prerequisites & Installation](#prerequisites--installation)
3. [Authentication & Initial Setup](#authentication--initial-setup)
4. [Project Linking (`.infisical.json`)](#project-linking-infisicaljson)
5. [Core Workflows](#core-workflows)
   - [Workflow 1: Runtime Secret Injection (Recommended)](#workflow-1-runtime-secret-injection-recommended)
   - [Workflow 2: Exporting Secrets to a `.env` File](#workflow-2-exporting-secrets-to-a-env-file)
   - [Workflow 3: Pushing & Managing Secrets via CLI](#workflow-3-pushing--managing-secrets-via-cli)
   - [Workflow 4: Personal Secret Overrides](#workflow-4-personal-secret-overrides)
6. [Team Collaboration & Sharing](#team-collaboration--sharing)
7. [Docker & Container Integration](#docker--container-integration)
8. [CI/CD Automation & Machine Identities](#cicd-automation--machine-identities)
9. [Security Best Practices](#security-best-practices)
10. [Cheat Sheet & Quick Reference](#cheat-sheet--quick-reference)

---

## 1. Why Use Infisical?

Sharing `.env` files over Slack, email, or chat creates security risks and leads to out-of-sync configuration drift across developers.

Infisical provides:
- **Centralized encrypted secret store** with role-based access control (RBAC).
- **Zero plain-text disk storage** via runtime injection (`infisical run`).
- **Seamless team syncing**: When one developer updates or adds a secret, everyone gets it immediately.
- **Environment isolation** (`dev`, `staging`, `prod`) and folder paths.
- **Personal overrides** so developers can test custom configs without polluting shared team values.

---

## 2. Prerequisites & Installation

### Windows
```powershell
# Using Scoop
scoop bucket add infisical https://github.com/Infisical/scoop-infisical.git
scoop install infisical

# Or using Chocolatey
choco install infisical

# Or using Winget
winget install Infisical.InfisicalCLI
```

### macOS
```bash
# Using Homebrew
brew install infisical/get-cli/infisical
```

### Linux (Ubuntu / Debian)
```bash
curl -1sLf 'https://dl.cloudsmith.io/public/infisical/infisical-cli/setup.deb.sh' | sudo -E bash
sudo apt-get update && sudo apt-get install -y infisical
```

### Verify Installation
```bash
infisical --version
```

---

## 3. Authentication & Initial Setup

### Interactive Login (Local Developer Machine)
Run the login command:
```bash
infisical login
```
You will be prompted to select your instance:
- **Infisical Cloud (US)** (Default: `https://app.infisical.com`)
- **Infisical Cloud (EU)** (`https://eu.infisical.com`)
- **Self-hosted instance**

> **Note (Headless / SSH / Remote environments):**
> If you are on a remote server, Codespace, or WSL without browser access, run:
> ```bash
> infisical login -i
> ```

### Custom Domain / Self-Hosted Configuration (Optional)
If using EU Cloud or a self-hosted instance, you can set the domain globally:
```bash
# Linux / macOS
export INFISICAL_DOMAIN="https://eu.infisical.com"

# Windows PowerShell
setx INFISICAL_DOMAIN "https://eu.infisical.com"
```

---

## 4. Project Linking (`.infisical.json`)

To link your local repository to your Infisical project:

1. Navigate to the root of the project:
   ```bash
   cd corelink_server
   ```
2. Initialize the project link:
   ```bash
   infisical init
   ```
3. Follow the interactive prompts to select your **Organization** and **Project**.

This creates a `.infisical.json` configuration file at the root:
```json
{
  "workspaceId": "<your-project-workspace-id>",
  "defaultEnvironment": "dev"
}
```

> ⚠️ **Important:**
> `.infisical.json` contains **no secrets** (only project/workspace IDs). **Commit this file to git** so all team members are automatically pointed to the same Infisical project.

---

## 5. Core Workflows

### Workflow 1: Runtime Secret Injection (Recommended)
Instead of creating `.env` files on disk, inject environment variables directly into the application process in memory.

```bash
# Run application with dev secrets injected
infisical run --env=dev -- npm run dev

# Run with custom start scripts (Node, Python, Go, etc.)
infisical run --env=dev -- node server.js

# Auto-restart application on secret changes with --watch
infisical run --env=dev --watch -- npm run dev
```

#### Secrets in Subfolders:
If your project organizes secrets into folders (e.g. `/backend`):
```bash
infisical run --env=dev --path="/backend" --recursive -- npm run dev
```

#### Chaining Commands:
If you need to chain commands, use `--command`:
```bash
infisical run --env=dev --command="npm run build && npm run start"
```

---

### Workflow 2: Exporting Secrets to a `.env` File
If a tool or IDE requires a physical `.env` file on disk:

```bash
# Standard .env export
infisical export --env=dev > .env

# Using the output-file flag
infisical export --env=dev --output-file=.env

# Export format with 'export' keyword for sourcing in bash/zsh
infisical export --env=dev --format=dotenv-export > .env

# Export as JSON or YAML
infisical export --env=dev --format=json > secrets.json
infisical export --env=dev --format=yaml > secrets.yaml
```

> 🔒 **Security Notice:**
> Always verify that `.env` is listed in your `.gitignore` to prevent accidental commits of plaintext credentials.

---

### Workflow 3: Pushing & Managing Secrets via CLI

#### 1. Import Existing `.env` into Infisical
- **Via Infisical Dashboard (Easiest for bulk import):**
  Open your project in the Infisical Web App ➔ Click **Import from .env** ➔ Paste `.env` content ➔ Select environment (`dev`, `staging`, `prod`) ➔ Save.
- **Via CLI (Iterative upload):**
  ```bash
  # Set a single secret
  infisical secrets set DATABASE_URL="postgresql://user:password@localhost:5432/corelink" --env=dev

  # Set multiple secrets
  infisical secrets set PORT=8080 JWT_SECRET="super-secret-key" --env=dev

  # Set secret value from a file (e.g. certificate or private key)
  infisical secrets set PRIVATE_KEY=@./keys/private.pem --env=dev
  ```

#### 2. View and Manage Secrets
```bash
# List secrets in the current environment
infisical secrets --env=dev

# Get a specific secret value
infisical secrets get DATABASE_URL --env=dev

# Delete a secret
infisical secrets delete DATABASE_URL --env=dev

# Generate a sanitized .env.example with keys only
infisical secrets generate-example --env=dev > .env.example
```

---

### Workflow 4: Personal Secret Overrides

Developers often need different local values (e.g., custom local DB port, local debugging flags) without overwriting shared team secrets.

1. Open the Infisical Web UI.
2. Under your Project Secrets, hover over any secret and click **Personal Override**.
3. Set your personal value.
4. When you run `infisical run` or `infisical export`, your personal override is used locally without changing the shared secret for other teammates.

---

## 6. Team Collaboration & Sharing

### Onboarding a New Team Member
1. Invite the teammate to the Infisical project via the Web Dashboard (**Project Settings > Members**).
2. The new teammate installs Infisical CLI and logs in:
   ```bash
   infisical login
   ```
3. They clone the repository:
   ```bash
   git clone <repo-url>
   cd corelink_server
   ```
4. They run the project immediately with zero `.env` copy-pasting:
   ```bash
   infisical run -- npm run dev
   ```

---

## 7. Docker & Container Integration

### Dockerfile
Install Infisical inside your container image and inject secrets at runtime:

```dockerfile
FROM node:20-alpine

# Install Infisical CLI
RUN apk add --no-cache bash wget && \
    wget -qO- 'https://artifacts-cli.infisical.com/setup.apk.sh' | sh && \
    apk update && apk add infisical

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .

# Run with secrets injected using machine token
CMD ["infisical", "run", "--env=prod", "--", "npm", "start"]
```

### Running the Container
Pass the machine authentication token:
```bash
docker run --env INFISICAL_TOKEN=$INFISICAL_TOKEN -p 8080:8080 corelink-server
```

---

## 8. CI/CD Automation & Machine Identities

For automated environments (GitHub Actions, GitLab CI, Docker, Kubernetes):

1. In Infisical, create a **Machine Identity** (or Service Token) under **Project Settings > Machine Identities**.
2. Assign it read access to the relevant environment (e.g., `prod` or `staging`).
3. Set `INFISICAL_TOKEN` in your CI/CD repository secrets.

### GitHub Actions Example
```yaml
name: Deploy Corelink Server

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Install Infisical CLI
        run: |
          curl -1sLf 'https://dl.cloudsmith.io/public/infisical/infisical-cli/setup.deb.sh' | sudo -E bash
          sudo apt-get update && sudo apt-get install -y infisical

      - name: Build and Deploy with Secrets
        env:
          INFISICAL_TOKEN: ${{ secrets.INFISICAL_TOKEN }}
        run: |
          infisical run --env=prod -- npm run build
          infisical run --env=prod -- npm run test
```

---

## 9. Security Best Practices

1. **Never commit `.env` files**: Ensure `.env`, `.env.local`, and `.env.*` remain in `.gitignore`.
2. **Commit `.infisical.json`**: This file contains only project metadata and no secrets.
3. **Prevent secrets from leaking into shell history**:
   Add the following to your shell profile (`~/.bashrc` or `~/.zshrc`):
   ```bash
   export HISTIGNORE="*infisical secrets set*:$HISTIGNORE"
   ```
4. **Use least privilege access**: Give developers access only to environments they need (`dev`, `staging`), restricting `prod` access to CI/CD machine identities.

---

## 10. Cheat Sheet & Quick Reference

| Action | Command |
| :--- | :--- |
| **Log in** | `infisical login` |
| **Link repo** | `infisical init` |
| **Run app with secrets** | `infisical run --env=dev -- <start-command>` |
| **Run app & auto-reload on secret change** | `infisical run --env=dev --watch -- <start-command>` |
| **Export secrets to `.env`** | `infisical export --env=dev > .env` |
| **Export to `.env` file directly** | `infisical export --env=dev --output-file=.env` |
| **List secrets** | `infisical secrets --env=dev` |
| **Set a secret** | `infisical secrets set KEY="value" --env=dev` |
| **Delete a secret** | `infisical secrets delete KEY --env=dev` |
| **Generate `.env.example`** | `infisical secrets generate-example --env=dev > .env.example` |

For more details, visit the [official Infisical CLI documentation](https://infisical.com/docs/cli/usage).
