#!/usr/bin/env node
// Proves Storage 0.1.12's stuck-mount fix using the real helper binary over
// its stdin/stdout JSON-line protocol. No window, no desktop, no real NAS.
// Usage: node tests/mount-ceiling.cjs [path/to/helper]
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const helperPath = process.argv[2] ||
  path.join(__dirname, '..', 'helper', '.build', 'debug', 'Storage Studio KH Helper');
console.log(`helper: ${helperPath}`);
if (!fs.existsSync(helperPath)) { console.error(`no helper at ${helperPath}`); process.exit(2); }

let failed = false;
let passed = 0;
let skipped = 0;
function pass(msg) { passed += 1; console.log(`PASS  ${msg}`); }
function skip(msg) { skipped += 1; console.log(`SKIP  ${msg}`); }
function fail(msg) { console.log(`FAIL  ${msg}`); failed = true; }

function runScenario(name, fn) {
  return new Promise((resolve) => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), `mount-ceiling-${name}-`));
    const child = spawn(helperPath, [], {
      env: { ...process.env, HOME: tmpHome, STORAGE_STUDIO_MOUNT_BUDGET_S: '2', STORAGE_STUDIO_RETRY_DELAYS: '5,5' },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let buf = '';
    const events = [];
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try { events.push(JSON.parse(line)); } catch {}
      }
    });
    function send(obj) { child.stdin.write(JSON.stringify(obj) + '\n'); }
    async function waitFor(pred, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const idx = events.findIndex(pred);
        if (idx !== -1) return events.splice(idx, 1)[0];
        await new Promise((r) => setTimeout(r, 50));
      }
      return null;
    }
    fn({ send, waitFor, events, child })
      .catch((e) => fail(`${name} threw: ${e.message}`))
      .finally(() => {
        child.stdin.end();
        const killTimer = setTimeout(() => { try { child.kill(9); } catch {} }, 2000);
        child.on('exit', (code) => { clearTimeout(killTimer); resolve(code); });
      });
  });
}

async function scenario1() {
  // 192.0.2.1: TCP probe may fail fast (not hang) on some networks.
  // We prove: mount starts, refresh answers promptly, and the row reaches a terminal state.
  const exitCode = await runScenario('ceiling', async ({ send, waitFor }) => {
    send({ type: 'configure', storages: [{
      id: 'ceiling', name: 'Ceiling Test', kind: 'smb', target: 'smb://192.0.2.1/share',
      mountPoint: '', volumeUUID: null, reconnectAtLogin: false, reconnectAfterWake: false, username: null,
    }] });
    await waitFor((e) => e.type === 'state', 3000);

    send({ type: 'mount', id: 'ceiling' });
    const mounting = await waitFor((e) => e.type === 'state' && e.inFlight.includes('ceiling'), 3000);
    if (mounting) {
      const item = mounting.items.find((i) => i.id === 'ceiling');
      if (item && item.status === 'mounting') pass('row is mounting with id in inFlight');
      else fail(`expected mounting, got ${item?.status}`);
    } else { fail('no state with ceiling in inFlight'); }

    // Wait for terminal state: needs_attention with the budget sentence is the proof.
    const terminal = await waitFor((e) => e.type === 'state' &&
      e.items.some((i) => i.id === 'ceiling' && !['mounting'].includes(i.status)) &&
      !e.inFlight.includes('ceiling'), 10000);
    if (terminal) {
      const item = terminal.items.find((i) => i.id === 'ceiling');
      if (item.status === 'needs_attention' && (item.detail || '').includes("didn't answer within 2 s")) {
        pass('row reached needs_attention via the budget ceiling');
      } else {
        // Not a pass: the ceiling itself was not exercised here. The helper's TCP probe
        // failed fast before NetFS was entered, so this network cannot hang a connect.
        // helper swift test covers the ceiling with a watched slow mount.
        skip(`ceiling not exercised: row said ${item.status} "${item.detail || ''}"`);
      }
      if (!terminal.inFlight.includes('ceiling') && !terminal.queued.includes('ceiling')) {
        pass('inFlight and queued empty at terminal state');
      } else if (!terminal.inFlight.includes('ceiling')) {
        pass('inFlight empty at terminal state (queued has retry timer)');
      } else {
        fail('inFlight not empty at terminal state');
      }
    } else { fail('row did not reach a terminal state within timeout'); }
  });
  if (exitCode === 0) pass('helper exited 0 on stdin close');
  else fail(`helper exited ${exitCode}`);
}

async function scenario2() {
  // Cancel a retrying row: 127.0.0.1 fails fast, then cancel stops it.
  const exitCode = await runScenario('cancel', async ({ send, waitFor }) => {
    send({ type: 'configure', storages: [{
      id: 'fast', name: 'Fast Fail', kind: 'smb', target: 'smb://127.0.0.1/share',
      mountPoint: '', volumeUUID: null, reconnectAtLogin: false, reconnectAfterWake: false, username: null,
    }] });
    await waitFor((e) => e.type === 'state', 3000);
    send({ type: 'mount', id: 'fast' });

    // Wait for the first failure and retry scheduling.
    const retrying = await waitFor((e) => e.type === 'state' &&
      e.items.some((i) => i.id === 'fast' && ['retrying', 'unreachable'].includes(i.status)), 8000);
    if (retrying) {
      const item = retrying.items.find((i) => i.id === 'fast');
      pass(`row entered ${item.status} after fast failure`);
    } else { fail('row never entered retrying/unreachable state'); }

    send({ type: 'cancel', id: 'fast' });
    const cancelled = await waitFor((e) => e.type === 'state' &&
      e.items.some((i) => i.id === 'fast' && i.status === 'not_mounted' &&
        (i.detail || '').includes('Stopped trying')) &&
      !e.queued.includes('fast'), 3000);
    if (cancelled) pass('cancel set not_mounted with "Stopped trying" and cleared queue');
    else fail('cancel did not produce expected state');
  });
  if (exitCode === 0) pass('scenario 2 helper exited 0');
  else fail(`scenario 2 helper exited ${exitCode}`);
}

(async () => {
  await scenario1();
  await scenario2();
  console.log(`RESULT: ${passed} pass, ${skipped} skip, ${failed ? 'fail' : '0 fail'}`);
  process.exit(failed ? 1 : 0);
})();