import { DiscordSDK } from '@discord/embedded-app-sdk';
import { apiFetch } from './request';
export const ACTIVITY_ORIGIN = 'https://1434488648228929629.discordsays.com';
export function isActivityLaunch(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.location.origin === ACTIVITY_ORIGIN || window.self !== window.top)
  );
}
let sdk: DiscordSDK | undefined;
export function singleFlight<T>(work: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () =>
    (pending ??= work().finally(() => {
      pending = undefined;
    }));
}
export const startActivity = singleFlight(async (): Promise<BrowserSession> => {
  if (window.location.origin !== ACTIVITY_ORIGIN)
    throw new Error('Activity must run through the Discord proxy');
  const response = await apiFetch('/api/activity/config', { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Discord Activity unavailable');
  const config = (await response.json()) as { clientId: string };
  sdk ??= new DiscordSDK(config.clientId, { disableConsoleLogOverride: true });
  return bootstrapActivity(sdk, config.clientId);
});
export interface ActivitySdk {
  guildId: string | null;
  channelId: string | null;
  ready(): Promise<unknown>;
  commands: {
    authorize(args: {
      client_id: string;
      response_type: 'code';
      state: string;
      prompt: 'none';
      scope: ['identify'];
    }): Promise<{ code: string }>;
    authenticate(args: { access_token: string }): Promise<unknown>;
  };
}
export interface BrowserSession {
  authenticated: boolean;
  identity?: { subject: string; name: string; avatarUrl?: string };
  csrfToken?: string;
  expiresAt?: number;
}
export async function bootstrapActivity(
  sdk: ActivitySdk,
  clientId: string,
  request = apiFetch,
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<BrowserSession> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, options.timeoutMs ?? 30000);
  const step = <T>(promise: Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const cancelled = () => reject(new Error('Discord authorization timed out or cancelled'));
      if (controller.signal.aborted) return cancelled();
      controller.signal.addEventListener('abort', cancelled, { once: true });
      promise
        .then(resolve, reject)
        .finally(() => controller.signal.removeEventListener('abort', cancelled));
    });
  try {
    await step(sdk.ready());
    const { code } = await step(
      sdk.commands.authorize({
        client_id: clientId,
        response_type: 'code',
        state: '',
        prompt: 'none',
        scope: ['identify'],
      })
    );
    const response = await step(
      request('/api/activity/exchange', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, guildId: sdk.guildId, channelId: sdk.channelId }),
      })
    );
    if (!response.ok) throw new Error('Discord authorization failed');
    let token: { access_token: string } | null = await step(response.json());
    try {
      await step(sdk.commands.authenticate({ access_token: token!.access_token }));
    } finally {
      token = null;
    }
    const session = await step(request('/api/activity/session', { signal: controller.signal }));
    if (!session.ok) throw new Error('Discord session unavailable');
    const value = (await step(session.json())) as BrowserSession;
    if (!value.authenticated) throw new Error('Discord session expired');
    return value;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
