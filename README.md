# Button Gremlin

Discord soundboard bot that plays sounds on command.

## Setup

1. Install dependencies: `pnpm install`
2. Copy `.env.example` to `.env` and add your Discord bot credentials
3. Deploy commands: `pnpm run deploy`
4. Start bot: `pnpm run dev`

## Commands

- `/ping` - Test bot responsiveness
- `/play <sound>` - Play sound (autocomplete available)
- `/list [page]` - List all sounds
- `/upload <file>` - Upload sound (max 10MB)
- `/disconnect` - Disconnect from voice

## License

MIT
