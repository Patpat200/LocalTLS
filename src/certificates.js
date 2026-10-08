import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { X509Certificate } from 'node:crypto';

function mkcert(args) {
  try { execFileSync('mkcert', args, { stdio: 'inherit', windowsHide: true }); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('mkcert was not found. On Windows: winget install --id FiloSottile.mkcert -e\nThen open a new terminal and run: local-https init');
    throw new Error('mkcert failed. Check its output above and your system permissions.');
  }
}
export function initializeTrust() { mkcert(['-install']); }

export function loadCertificates({ cert, key, certDir } = {}) {
  if (Boolean(cert) !== Boolean(key)) throw new Error('--cert and --key must be provided together.');
  if (cert && key) return { cert: readFileSync(resolve(cert)), key: readFileSync(resolve(key)) };
  const dir = resolve(certDir || join(homedir(), '.local-https-kit'));
  const certPath = join(dir, 'localhost.pem');
  const keyPath = join(dir, 'localhost-key.pem');
  let fresh = false;
  if (existsSync(certPath) && existsSync(keyPath)) {
    try {
      const existing = new X509Certificate(readFileSync(certPath));
      fresh = Date.parse(existing.validFrom) <= Date.now() && Date.parse(existing.validTo) > Date.now() + 7 * 86400000 && Boolean(existing.checkHost('localhost'));
    } catch { /* Regenerate invalid certificates. */ }
  }
  if (!fresh) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    mkcert(['-cert-file', certPath, '-key-file', keyPath, 'localhost', '127.0.0.1', '::1']);
    chmodSync(keyPath, 0o600);
  }
  return { cert: readFileSync(certPath), key: readFileSync(keyPath) };
}
