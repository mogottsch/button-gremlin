import { test, expect } from '@playwright/test';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
test.use({
  ignoreHTTPSErrors: true,
  launchOptions: {
    args: [
      '--host-resolver-rules=MAP 1434488648228929629.discordsays.com 127.0.0.1',
      '--no-proxy-server',
      '--disable-features=LocalNetworkAccessChecks',
    ],
  },
});
let proxyServer: https.Server | undefined;
let certDir: string | undefined;
test.afterEach(async () => {
  const server = proxyServer;
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
  if (certDir) rmSync(certDir, { recursive: true, force: true });
});
const proxy = 'https://1434488648228929629.discordsays.com';
test('real SDK iframe auto authentication, cookie preview and expiry recovery never navigate to OIDC', async ({
  page,
  context,
}) => {
  const commands: string[] = [];
  certDir = mkdtempSync(path.join(process.env.TMPDIR ?? '/opt/data/cache/scratch', 'bg-proxy-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      path.join(certDir, 'key.pem'),
      '-out',
      path.join(certDir, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=1434488648228929629.discordsays.com',
    ],
    { stdio: 'ignore' }
  );
  proxyServer = https.createServer(
    {
      key: readFileSync(path.join(certDir, 'key.pem')),
      cert: readFileSync(path.join(certDir, 'cert.pem')),
    },
    async (req, res) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const headers = Object.fromEntries(
          Object.entries(req.headers)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [key, Array.isArray(value) ? value.join('; ') : String(value)])
        );
        const response = await fetch('http://127.0.0.1:13000' + req.url, {
          method: req.method,
          headers: { ...headers, host: '127.0.0.1:13000' },
          body: chunks.length ? Buffer.concat(chunks).toString() : undefined,
          redirect: 'manual',
        });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        res.writeHead(502);
        res.end();
      }
    }
  );
  const server = proxyServer;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(443, '127.0.0.1', resolve);
  });
  await page.route('https://discord.com/activity-harness', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<script>
 window.commands=[];
 addEventListener('message',e=>{
 const [op,p]=e.data;if(op===0)e.source.postMessage([1,{cmd:'DISPATCH',evt:'READY',nonce:null,data:{v:1,config:{cdn_host:'cdn.discordapp.com',api_endpoint:'//discord.com/api',environment:'production'},user:{id:'333333333333333333',username:'Fixture',discriminator:'0',avatar:'fixture',public_flags:0}}}],e.origin);
 if(op===1){window.commands.push(p);let data={};if(p.cmd==='AUTHORIZE')data={code:'CODE-'+crypto.randomUUID()};
 if(p.cmd==='AUTHENTICATE')data={access_token:p.args.access_token,user:{id:'333333333333333333',username:'Fixture',discriminator:'0',avatar:'fixture',public_flags:0},scopes:['identify'],expires:'2099-01-01T00:00:00Z',application:{id:'1434488648228929629',name:'Fixture',icon:null,description:'Fixture'}};
 e.source.postMessage([1,{cmd:p.cmd,nonce:p.nonce,evt:null,data}],e.origin);}
 });</script><iframe style="width:1100px;height:850px" src="${proxy}/?frame_id=frame&instance_id=instance&platform=desktop&guild_id=111111111111111111&channel_id=222222222222222222"></iframe>`,
    })
  );
  page.on('request', (r) => {
    if (r.url().includes('/api/auth/login')) commands.push('OIDC');
  });

  await page.goto('https://discord.com/activity-harness');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('button', { name: 'Logout' })).toBeVisible();
  const cookie = (await context.cookies()).find((c) => c.name === '__Secure-bg_activity');
  expect(cookie?.domain).toBe('.1434488648228929629.discordsays.com');
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.secure).toBe(true);
  expect(cookie?.sameSite).toBe('None');
  expect(cookie?.partitionKey).toBeTruthy();
  await frame
    .locator('.group')
    .filter({ hasText: 'Fixture Sound' })
    .locator('button')
    .first()
    .click();
  await expect
    .poll(() => frame.locator('audio').evaluate((a: HTMLAudioElement) => a.readyState))
    .toBeGreaterThanOrEqual(2);
  expect(await frame.locator('audio').getAttribute('src')).toMatch(/^blob:/);
  const inner = page.frames().find((f) => f.url().startsWith(proxy))!;
  expect(await inner.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('TOKEN');
  await context.request.post('http://127.0.0.1:13001/activity-revoke');
  await frame.getByRole('button', { name: 'Logout' }).click();
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(() => (window as unknown as { commands: { cmd: string }[] }).commands)
        ).filter((c) => c.cmd === 'AUTHORIZE').length
    )
    .toBeGreaterThanOrEqual(2);
  await expect(frame.getByRole('button', { name: 'Logout' })).toBeVisible();
  expect(commands).toEqual([]);
  const rpc = await page.evaluate(
    () =>
      (window as unknown as { commands: { cmd: string; args?: { prompt?: string } }[] }).commands
  );
  expect(rpc.filter((c) => c.cmd === 'AUTHORIZE').every((c) => c.args?.prompt === 'none')).toBe(
    true
  );
});
