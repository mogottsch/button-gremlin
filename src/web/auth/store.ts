import { createClient } from 'redis';
import { createHmac, randomBytes } from 'node:crypto';
export const SESSION_SECONDS = 900;
export const TRANSACTION_SECONDS = 600;
export const randomToken = (): string => randomBytes(32).toString('base64url');
export interface Identity {
  issuer: string;
  subject: string;
  name: string;
  avatarUrl?: string;
}
export interface Transaction {
  binding: string;
  nonce: string;
  verifier: string;
  returnTo: string;
}
export interface Session {
  identity: Identity;
  csrfToken: string;
  expiresAt: number;
  generation: string;
}
export interface AuthStore {
  putTransaction(state: string, tx: Transaction): Promise<void>;
  takeTransaction(state: string, binding: string): Promise<Transaction | null>;
  createSession(identity: Identity): Promise<string>;
  getSession(token: string): Promise<Session | null>;
  deleteSession(token: string): Promise<void>;
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
      .set(this.key('tx', state), JSON.stringify(tx), { EX: TRANSACTION_SECONDS, NX: true });
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
  async createSession(identity: Identity): Promise<string> {
    const token = randomToken();
    const initial = randomToken();
    const session: Session = {
      identity,
      csrfToken: randomToken(),
      expiresAt: Date.now() + SESSION_SECONDS * 1000,
      generation: '',
    };
    // Generation initialization and issuance are one transaction relative to revoke.
    await this.client
      .withCommandOptions({ timeout: 5000 })
      .eval(
        "redis.call('SET',KEYS[1],ARGV[1],'NX'); local s=cjson.decode(ARGV[2]); s.generation=redis.call('GET',KEYS[1]); redis.call('SET',KEYS[2],cjson.encode(s),'EX',ARGV[3]); return 1",
        {
          keys: [this.subjectKey(identity), this.key('session', token)],
          arguments: [initial, JSON.stringify(session), String(SESSION_SECONDS)],
        }
      );
    return token;
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
    return session;
  }
  async deleteSession(token: string): Promise<void> {
    await this.client.withCommandOptions({ timeout: 5000 }).del(this.key('session', token));
  }
  async revokeSubject(issuer: string, subject: string): Promise<void> {
    if (!issuer || !subject || issuer.trim() !== issuer || subject.trim() !== subject)
      throw new Error('Exact nonempty identity required');
    // Random generations also fail closed after an accidental missing-key restore.
    await this.client
      .withCommandOptions({ timeout: 5000 })
      .set(this.subjectKey({ issuer, subject }), randomToken());
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
