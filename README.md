# Corelink Server

Corelink Server repository.

## Environment Variables & Secret Management

We use [Infisical](https://infisical.com/) to securely manage and sync environment variables across the team.

### Quick Start with Infisical

1. **Install Infisical CLI**:
   - **Windows (Winget):** `winget install infisical`
   - **macOS (Homebrew):** `brew install infisical/get-cli/infisical`
   - **Linux:** See [INFISICAL.md](file:///c:/Users/Neptune/Documents/Projects/corelink_server/INFISICAL.md)
2. **Authenticate**:
   ```bash
   infisical login
   ```
3. **Link repository**:
   ```bash
   infisical init
   ```
4. **Run with injected secrets**:
   ```bash
   infisical run --env=dev -- npm run dev
   ```

For the complete guide on sharing secrets, personal overrides, exporting `.env` files, Docker, and CI/CD setups, see [INFISICAL.md](file:///c:/Users/Neptune/Documents/Projects/corelink_server/INFISICAL.md).

## Deployment (Vercel)

The server is configured for serverless deployment on Vercel.

- **Live URL:** [https://corelink-server.vercel.app](https://corelink-server.vercel.app)
- **Health Check:** [https://corelink-server.vercel.app/api/health](https://corelink-server.vercel.app/api/health)

For full deployment instructions, environment variable setups, and CLI workflows, see [VERCEL.md](file:///c:/Users/Neptune/Documents/Projects/corelink_server/VERCEL.md).

