# LocalTLS

A local HTTPS proxy for development websites. Your application keeps running over
HTTP while the proxy provides an HTTPS entry point and forwards WebSocket connections.
Requires Node.js 22 or later. No npm runtime dependencies.

## Quick start from this directory

Install [mkcert](https://github.com/FiloSottile/mkcert) to generate certificates
trusted by your machine. On Windows:

```powershell
winget install --id FiloSottile.mkcert -e
```

Open a new terminal, then run these commands from the project directory:

```powershell
node bin/local-https.js init
node bin/local-https.js 3000
```

`init` runs `mkcert -install`, adding a local certificate authority to supported
trust stores. Your system may request administrator privileges. This is a one-time
setup per machine. Start your application separately on port 3000; the proxy does
not start it for you.

Open **https://localhost:3443**. Your browser should trust the certificate after
`init`; some browsers may require additional configuration or a restart.
The certificate covers localhost, 127.0.0.1, and ::1, but the server listens on the
address your system selects for localhost. Use the displayed localhost URL.

## Install the command from the local project

```powershell
npm install --global .
local-https init
local-https 3000
local-https --target http://localhost:5173 --port 5443
```

The package has not been published to npm. Check name availability before publishing.
`npx local-https-kit` is therefore not an installation command for this version.

## Features

- mkcert certificates cached in `~/.local-https-kit` and regenerated on startup when fewer than seven days of validity remain.
- WebSocket forwarding for development servers; streaming HTTP and SSE without buffering entire responses.
- Forwarding of methods, paths, query parameters, request bodies, and cookies.
- `X-Forwarded-*` headers, connection header filtering, and HTTPS rewriting of absolute redirects pointing to the target.
- 502 responses when the target is unavailable and 504 responses after 30 seconds of HTTP inactivity.
- Localhost binding, clear port conflict messages, and tunnel cleanup on Ctrl+C.
- HTTP or HTTPS targets, with TLS verification enabled for HTTPS targets.

## Custom certificates

```powershell
local-https 3000 --cert ./cert.pem --key ./key.pem
local-https 3000 --cert-dir ./.local-https
```

mkcert is not required when you supply both `--cert` and `--key`. An untrusted
self-signed certificate will trigger a browser warning; the proxy does not disable
certificate verification. Do not share your certificate private keys or mkcert's
root private key.

## Use in another project

After installing this package locally (`npm install --save-dev <path-to-this-directory>`),
add the following script to your application's `package.json`:

```json
{
  "scripts": {
    "https": "local-https 3000"
  }
}
```

Start your application in one terminal, then run `npm run https` in another.

## Node.js API

```js
import { readFileSync } from 'node:fs';
import { createProxy } from 'local-https-kit';

const proxy = createProxy({
  target: 'http://127.0.0.1:3000',
  cert: readFileSync('cert.pem'),
  key: readFileSync('key.pem'),
});
proxy.listen(3443, 'localhost');
// await proxy.stop();
```

## Limitations

This tool is intended for local development. It does not rewrite HTTP URLs embedded
in HTML/JavaScript or cookie domains. Configure your framework's public HTTPS URL
when needed. The forwarded Host header identifies the target; original request
information is provided through X-Forwarded-Host and X-Forwarded-Proto. Some
applications require configuration to recognize the proxy. WebSockets are tunneled;
depending on your framework, configure the public HMR URL to use `wss` on the HTTPS
port. Other Upgrade protocols and HTTP/2 are not supported.

## Testing and packaging

```powershell
npm test
npm pack --dry-run
npm pack
```

Tests use a **public, test-only** private key and certificate in `test/fixtures`.
These files are excluded from the distributed package and must never be used for
a real server. Tests do not install any trusted certificates. The optional Python
generator can regenerate the fixtures; the tests themselves require only Node.js.

MIT license. TLS and proxy functionality use Node.js's official
[HTTPS](https://nodejs.org/api/https.html) and [HTTP](https://nodejs.org/api/http.html) modules.
