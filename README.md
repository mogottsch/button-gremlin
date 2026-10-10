# Button Gremlin

Discord soundboard bot that plays sounds on command, with a modern web UI for managing and playing sounds.

## Quick Start

### Docker (Production)

Pull and run from GitHub Container Registry:

```bash
docker pull ghcr.io/mogottsch/button-gremlin:latest

docker run -p 3000:3000 \
  -v /path/to/sounds:/app/sounds \
  -e DISCORD_TOKEN=your_token \
  -e DISCORD_CLIENT_ID=your_client_id \
  -e WEB_ENABLED=true \
  -e WEB_PORT=3000 \
  --env-file /secure/path/button-gremlin.env \
  ghcr.io/mogottsch/button-gremlin:latest
```

Mount `/app/sounds` to persist uploaded sounds across container restarts. `BUTTON_GREMLIN_TAGS_FILE` defaults to legacy cwd `tags.json`; after an operator-owned atomic migration of existing tags, set it to `/app/sounds/metadata/tags.json` to persist global tags on the same mount. Sound metadata naming/listing is unchanged. The app does not automatically migrate or overwrite legacy tags.

Web mode requires a dedicated Authentik provider, the existing invitation broker, and private Redis. See [SSO configuration, testing and revocation](docs/authentik-oidc.md). Optional [Discord Activity automatic authentication and exact environment contract](docs/discord-activity.md) uses separate, launch-channel-scoped Discord sessions without changing standalone OIDC admission. Bot-only mode (`WEB_ENABLED=false`) does not require these services. Node >=22.12 is required.

### Development

1. Install dependencies:

   ```bash
   pnpm install
   cd web && pnpm install && cd ..
   ```

2. Configure environment:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your Discord bot token, client ID, and optional web settings.

3. Deploy Discord commands:

   ```bash
   pnpm run deploy
   ```

4. Start development:

   ```bash
   # Terminal 1: Backend
   pnpm run dev

   # Terminal 2: Frontend (optional - backend serves frontend in production)
   cd web && pnpm run dev
   ```

5. Production build:
   ```bash
   pnpm run build:all
   pnpm start
   ```

## Discord Commands

- `/ping` - Test bot responsiveness
- `/play <sound>` - Play sound (autocomplete available)
- `/list [page]` - List all sounds
- `/upload <file>` - Upload sound (max 10MB)
- `/disconnect` - Disconnect from voice

## Web UI Features

- 🔐 Discord → Authentik SSO with explicit Button Gremlin admission
- 🎵 Upload, delete, and play sounds
- 🎮 Play sounds in browser or Discord
- 🔍 Search and filter sounds
- 📱 Responsive design

## Architecture

- **Backend**: Node.js + TypeScript + Fastify + Discord.js
- **Frontend**: React + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Validation**: Zod schemas shared between backend and frontend
- **Static Serving**: Frontend served by Fastify with @fastify/static
- **CI/CD**: GitHub Actions builds and pushes to GHCR on push to main

## License

MIT
