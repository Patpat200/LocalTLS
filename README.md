# LocalTLS

A local HTTPS proxy for development websites. Your application keeps running over
HTTP while the proxy provides an HTTPS entry point and forwards WebSocket connections.
Requires Node.js 22 or later. No npm runtime dependencies.

Package name: `@gregos_/localtls`. Command name: `local-https`.

## Install from npm

Once the first version has been published to npm:

```powershell
npm install --global @gregos_/localtls
```

Install mkcert as described below, then run:

```powershell
local-https init
local-https 3000
```

For a one-off run without a global installation:

```powershell
npx @gregos_/localtls init
npx @gregos_/localtls 3000
```

## Set up trusted HTTPS

Install [mkcert](https://github.com/FiloSottile/mkcert) to generate certificates
trusted by your machine. On Windows:

```powershell
winget install --id FiloSottile.mkcert -e
```

Open a new terminal. With the global package installed, run:

```powershell
local-https init
local-https 3000
```

`init` runs `mkcert -install`, adding a local certificate authority to supported
trust stores. Your system may request administrator privileges. This is a one-time
setup per machine. Start your application separately on port 3000; the proxy does
not start it for you.

Open **https://localhost:3443**. Your browser should trust the certificate after
`init`; some browsers may require additional configuration or a restart.
The certificate covers localhost, 127.0.0.1, and ::1, but the server listens on the
address your system selects for localhost. Use the displayed localhost URL.

## Run from the source repository

Before npm publication, or when developing the package, clone the repository and
run directly from source:

```powershell
git clone https://github.com/Patpat200/LocalTLS.git
cd LocalTLS
npm ci
node bin/local-https.js init
node bin/local-https.js 3000
```

To install the command globally from the project directory:

```powershell
npm install --global .
local-https init
local-https 3000
local-https --target http://localhost:5173 --port 5443
```

The npm commands above become available after publication. The package uses the
`gregos_` organization scope; publishing requires permission in that organization.

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

After npm publication, install it as a development dependency:

```powershell
npm install --save-dev @gregos_/localtls
```

Before publication, use `npm install --save-dev <path-to-this-directory>` instead.
Add the following script to your application's `package.json`:

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
import { createProxy } from '@gregos_/localtls';

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
npm ci
npm test
npm pack --dry-run
npm pack
```

Tests generate fresh, short-lived certificates and private keys in memory using
the `selfsigned` development dependency. No certificate or private key files are
stored in the repository or written to disk by the tests. Tests do not install any
trusted certificates. Runtime usage still has no npm dependencies.

## Publish to npm

Maintainers should sign in with an npm account authorized to publish packages in
the `gregos_` organization. Enable two-factor authentication on that account for
interactive publishing.

From the project directory:

```powershell
npm ci
npm test
npm pack --dry-run
npm login
npm whoami
npm publish --access public
```

Review the file list printed by `npm pack --dry-run` before publishing. The package
includes only `bin`, `src`, `README.md`, `LICENSE`, and `package.json`; test code,
certificate files, and private keys are excluded. The `prepublishOnly` script runs
the tests again before publication. Public npm access is also set in `publishConfig`.

On Windows, if PowerShell blocks the `npm.ps1` script, use `npm.cmd` instead of `npm`
for these commands. Complete the browser login and two-factor prompts when asked.

## Publish with GitHub Actions

The workflow `.github/workflows/npm-publish.yml` uses Node.js 24 and npm trusted
publishing (OIDC). No `NPM_TOKEN` or `npm_token` GitHub secret is needed.

If the package does not yet exist on npm, publish its first version from your
computer using the commands above. Then open the package's **Settings** on npm,
find **Trusted Publisher**, select **GitHub Actions**, and enter:

| Field | Value |
| --- | --- |
| Organization or user | `Patpat200` |
| Repository | `LocalTLS` |
| Workflow filename | `npm-publish.yml` |
| Environment name | Leave empty |
| Allowed actions | Enable direct publishing with `npm publish` |

The workflow filename must match exactly; do not enter `.github/workflows/`.
Save the configuration. A new trust configuration must complete a successful
publish within two days; recreate it if it expires before use.

To publish a new patch version, start with a clean working tree and run:

```powershell
npm version patch
git push origin main --follow-tags
```

On GitHub, open **Releases → Draft a new release**, choose the new version tag
(for example, `v0.1.1`), and publish the release. The workflow checks that the tag
matches `package.json`, installs dependencies, checks the package contents, and
runs the tests before publishing to npm.

Alternatively, open **Actions → Publish to npm → Run workflow**, select `main`,
and run it manually. This publishes the version already committed in `package.json`;
it does not increment the version. Publishing an existing npm version will fail.
Pushing code alone does not publish a package. Creating a release or manually
running this workflow does publish it once npm trust is configured.

Follow progress under **Actions → Publish to npm**. If npm authentication fails,
check all trusted publisher fields and ensure `npm publish` is allowed.

Each published version must have a new version number. See npm's official
[trusted publishing guide](https://docs.npmjs.com/trusted-publishers/) and
[public package publishing guide](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/).

MIT license. TLS and proxy functionality use Node.js's official
[HTTPS](https://nodejs.org/api/https.html) and [HTTP](https://nodejs.org/api/http.html) modules.
