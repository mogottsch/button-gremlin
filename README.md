# Button Gremlin

Discord soundboard bot that plays sounds on command, with a modern web UI for managing and playing sounds.

## Setup

### Bot Setup

1. Install dependencies: `pnpm install`
2. Copy `.env.example` to `.env` and configure:

   ```env
   DISCORD_TOKEN=your_bot_token_here
   DISCORD_CLIENT_ID=your_client_id_here
   DISCORD_GUILD_ID=

   # Web UI (optional)
   WEB_ENABLED=true
   WEB_PORT=3000
   WEB_API_KEY=your-secret-key-here
   ```

3. Deploy commands: `pnpm run deploy`
4. Start bot: `pnpm run dev`

### Web UI Setup

1. Navigate to the web directory: `cd web`
2. Install frontend dependencies: `pnpm install`
3. Start the development server: `pnpm run dev`

The web UI will be available at `http://localhost:5173`

## Discord Commands

- `/ping` - Test bot responsiveness
- `/play <sound>` - Play sound (autocomplete available)
- `/list [page]` - List all sounds
- `/upload <file>` - Upload sound (max 10MB)
- `/disconnect` - Disconnect from voice

## Web UI Features

- 🔐 **Secure Login** - API key authentication
- 🎵 **Sound Management** - Upload, delete, and organize sounds
- 🎮 **Dual Playback** - Play sounds in browser or Discord
- 🔍 **Search & Filter** - Quickly find sounds
- 📱 **Responsive Design** - Works on desktop and mobile
- 🌙 **Dark Mode** - Built-in dark theme support

## Development

### Running Both Services

**Terminal 1** - Backend (Bot + API):

```bash
pnpm run dev
```

**Terminal 2** - Frontend (React):

```bash
cd web && pnpm run dev
```

### Production Build

1. Build frontend: `cd web && pnpm run build`
2. Build backend: `pnpm run build`
3. Start: `pnpm run start`

## Architecture

- **Backend**: Node.js + TypeScript + Express + Discord.js
- **Frontend**: React + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Validation**: Zod schemas shared between backend and frontend
- **Authentication**: Simple API key-based auth

## License

MIT
