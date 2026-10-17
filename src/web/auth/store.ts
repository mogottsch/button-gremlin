import { createClient } from 'redis';
import { createHmac, randomBytes } from 'node:crypto';
// Authorization lease, NOT the provider token or remembered SSO lifetime.
export const SESSION_SECONDS = 900;
export const TRANSACTION_SECONDS = 600;
const BROWSER_SECONDS = 30 * 86400 + SESSION_SECONDS + TRANSACTION_SECONDS;
export const randomToken = (): string => randomBytes(32).toString('base64url');
export class LoginInvalidated extends Error {}
export interface Identity {
  activity?: { guildId: string; channelId: string };
  issuer: string;
  subject: string;
  name: string;
  avatarUrl?: string;
}
export interface Transaction {
  logoutMarker?: string;
  explicit?: boolean;
  startedAt?: number;
  phase?: 'probe' | 'fallback';
  browser?: string;
  browserGeneration?: string;
  binding: string;
  nonce: string;
  verifier: string;
  returnTo: string;
}
export interface Session {
  logoutMarker?: string;
  browser?: string;
  browserGeneration?: string;
  identity: Identity;
  csrfToken: string;
  expiresAt: number;
  generation: string;
}
export interface AuthStore {
  putTransaction(state: string, tx: Transaction): Promise<void>;
  takeTransaction(state: string, binding: string): Promise<Transaction | null>;
  browserGeneration(browser: string): Promise<string>;
  validBrowserGeneration(browser: string, generation: string): Promise<boolean>;
  resumedAfterLogout(marker: string): Promise<boolean>;
  createSession(identity: Identity, guard?: Transaction): Promise<string>;
  getSession(token: string): Promise<Session | null>;
  deleteSession(token: string): Promise<void>;
  logoutSession(token: string, browser?: string): Promise<void>;
  revokeSubject(issuer: string, subject: string): Promise<void>;
  rateLimit(key: string, limit: number, seconds: number): Promise<boolean>;
  close(): Promise<void>;
}
export class RedisAuthStore implements AuthStore {
  private constructor(
    private client: ReturnType<typeof createClient>,
    private secret: string
  ) {}
  static async connect(url: string, secret: string): Promise<RedisAuthStore> {
    const client = createClient({
      url,
      disableOfflineQueue: true,
      socket: { connectTimeout: 5000, reconnectStrategy: false },
    });
    client.on('error', () => {
      /* Requests fail closed; never log Redis credentials. */
    });
    await client.connect();
    await client.ping();
    return new RedisAuthStore(client, secret);
  }
  key(kind: string, value: string): string {
    return 'bg:auth:' + kind + ':' + createHmac('sha256', this.secret).update(value).digest('hex');
  }
  private subjectKey(identity: Pick<Identity, 'issuer' | 'subject'>): string {
    return this.key('generation', JSON.stringify([identity.issuer, identity.subject]));
  }
  async putTransaction(state: string, tx: Transaction): Promise<void> {
    await this.client
      .withCommandOptions({ timeout: 5000 })
      .eval(
        "local s=cjson.decode(ARGV[1]); if s.phase and not s.startedAt then local t=redis.call('TIME'); s.startedAt=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000) end; return redis.call('SET',KEYS[1],cjson.encode(s),'EX',ARGV[2],'NX')",
        {
          keys: [this.key('tx', state)],
          arguments: [JSON.stringify(tx), String(TRANSACTION_SECONDS)],
        }
      );
  }
  async takeTransaction(state: string, binding: string): Promise<Transaction | null> {
    const raw = await this.client
      .withCommandOptions({ timeout: 5000 })
      .eval(
        "local v=redis.call('GET',KEYS[1]); if not v then return nil end; if cjson.decode(v).binding~=ARGV[1] then return nil end; redis.call('DEL',KEYS[1]); return v",
        { keys: [this.key('tx', state)], arguments: [binding] }
      );
    return typeof raw === 'string' ? (JSON.parse(raw) as Transaction) : null;
  }
  async browserGeneration(browser: string): Promise<string> {
    const value = await this.client
      .withCommandOptions({ timeout: 5000 })
      .eval(
        "redis.call('SET',KEYS[1],ARGV[1],'NX','EX',ARGV[2]); return redis.call('GET',KEYS[1])",
        {
          keys: [this.key('browser', browser)],
          arguments: [randomToken(), String(BROWSER_SECONDS)],
        }
      );
    return String(value);
  }
  async validBrowserGeneration(browser: string, generation: string): Promise<boolean> {
    return (
      (await this.client
        .withCommandOptions({ timeout: 5000 })
        .get(this.key('browser', browser))) === generation
    );
  }
  async createSession(identity: Identity, guard?: Transaction): Promise<string> {
    // Standalone callbacks must use a complete guard; Activity never owns one.
    if (
      guard &&
      (!guard.browser || !guard.browserGeneration || !guard.startedAt || identity.activity)
    )
      throw new Error('Invalid login guard');
    const token = randomToken();
    const initial = randomToken();
    const session: Session = {
      identity,
      csrfToken: randomToken(),
      expiresAt: Date.now() + SESSION_SECONDS * 1000,
      generation: '',
      ...(guard?.logoutMarker ? { logoutMarker: guard.logoutMarker } : {}),
      ...(guard ? { browser: guard.browser, browserGeneration: guard.browserGeneration } : {}),
    };
    // Generation initialization, browser epoch comparison and issuance are atomic.
    const created = await this.client
      .withCommandOptions({ timeout: 5000 })
      .eval(
        "if ARGV[4]~='' then if redis.call('GET',KEYS[3])~=ARGV[4] then return 0 end; local revoked=redis.call('GET',KEYS[4]); if revoked and tonumber(ARGV[5])<=tonumber(revoked) then return 0 end end; if ARGV[6]~='' and ARGV[7]~='1' and redis.call('GET',KEYS[5])~='1' then return 0 end; redis.call('SET',KEYS[1],ARGV[1],'NX'); local s=cjson.decode(ARGV[2]); s.generation=redis.call('GET',KEYS[1]); redis.call('SET',KEYS[2],cjson.encode(s),'EX',ARGV[3]); if ARGV[6]~='' and ARGV[7]=='1' then redis.call('SET',KEYS[5],'1','EX',ARGV[8]) end; return 1",
        {
          keys: [
            this.subjectKey(identity),
            this.key('session', token),
            this.key('browser', guard?.browser ?? ''),
            this.key('revokedAt', JSON.stringify([identity.issuer, identity.subject])),
            this.key('resumed', guard?.logoutMarker ?? ''),
          ],
          arguments: [
            initial,
            JSON.stringify(session),
            String(SESSION_SECONDS),
            guard?.browserGeneration ?? '',
            String(guard?.startedAt ?? 0),
            guard?.logoutMarker ?? '',
            guard?.explicit ? '1' : '0',
            String(BROWSER_SECONDS),
          ],
        }
      );
    if (!created) throw new LoginInvalidated('Login invalidated');
    return token;
  }
  async resumedAfterLogout(marker: string): Promise<boolean> {
    return (
      (await this.client.withCommandOptions({ timeout: 5000 }).get(this.key('resumed', marker))) ===
      '1'
    );
  }
  async getSession(token: string): Promise<Session | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const raw = await this.client
      .withCommandOptions({ timeout: 5000 })
      .get(this.key('session', token));
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    const generation = await this.client
      .withCommandOptions({ timeout: 5000 })
      .get(this.subjectKey(session.identity));
    if (!generation || generation !== session.generation || session.expiresAt <= Date.now())
      return null;
    if (session.browser) {
      const current = await this.client
        .withCommandOptions({ timeout: 5000 })
        .get(this.key('browser', session.browser));
      if (!current || current !== session.browserGeneration) return null;
    }
    return session;
  }
  async deleteSession(token: string): Promise<void> {
    await this.client.withCommandOptions({ timeout: 5000 }).del(this.key('session', token));
  }
  async logoutSession(token: string, browser?: string): Promise<void> {
    // Session records are immutable. Reading the binding before atomic DEL cannot
    // resurrect a removed token; its random identifier is never reused/upserted.
    const raw = await this.client
      .withCommandOptions({ timeout: 5000 })
      .get(this.key('session', token));
    const session = raw ? (JSON.parse(raw) as Session) : null;
    await this.client
      .withCommandOptions({ timeout: 5000 })
      .eval("redis.call('DEL',KEYS[1],KEYS[2],KEYS[3]); return 1", {
        keys: [
          this.key('session', token),
          this.key('browser', session?.browser ?? ''),
          this.key('browser', browser ?? ''),
        ],
        arguments: [],
      });
  }
  async revokeSubject(issuer: string, subject: string): Promise<void> {
    if (!issuer || !subject || issuer.trim() !== issuer || subject.trim() !== subject)
      throw new Error('Exact nonempty identity required');
    // Random generations also fail closed after an accidental missing-key restore.
    await this.client
      .withCommandOptions({ timeout: 5000 })
      .eval(
        "local t=redis.call('TIME'); redis.call('SET',KEYS[1],ARGV[1]); redis.call('SET',KEYS[2],tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)); return 1",
        {
          keys: [
            this.subjectKey({ issuer, subject }),
            this.key('revokedAt', JSON.stringify([issuer, subject])),
          ],
          arguments: [randomToken()],
        }
      );
  }
  async rateLimit(key: string, limit: number, seconds: number): Promise<boolean> {
    const n = await this.client
      .withCommandOptions({ timeout: 5000 })
      .eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
        { keys: [this.key('rate', key)], arguments: [String(seconds)] }
      );
    return Number(n) <= limit;
  }
  async close(): Promise<void> {
    if (this.client.isOpen) await this.client.quit();
  }
}
