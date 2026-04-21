# Batch 1 Spike Results (Camoufox + Lifetime + Runtime Paths)

## 1) Camoufox adapter surface (validated)

### Package/API shape
- Source inspected: `blueprints/.validation/camoufox-0.1.19/package/dist/*` and installed `node_modules/camoufox`.
- Exported API includes:
  - `Camoufox(launch_options)`
  - `NewBrowser(playwright, headless, fromOptions, persistentContext, debug, launch_options)`
  - `launchOptions(...)`
  - `getLaunchPath(...)`
  - binary helpers (`downloadBrowser`, CLI `camoufox fetch`, etc.)

### Persistent profile launch + BrowserContext
- Camoufox uses `data_dir` for persistent mode.
- In `NewBrowser(...)`, when `launch_options.data_dir` is set, it calls:
  - `playwright.launchPersistentContext(launch_options.data_dir, fromOptions)`
- Result type in this mode is `BrowserContext` (not `Browser`).
- `Browser` handle is available via `context.browser()`.

### Proven runtime launch path in this environment
- `import { Camoufox } from 'camoufox'` (ESM) fails here with dynamic-require error from package internals.
- `Camoufox(...)` via CJS also failed on macOS in this environment due a package path bug (`properties.json` lookup under `Contents/MacOS`).
- Working launch path (validated):
  1. `const { NewBrowser, launchOptions } = require('camoufox')`
  2. `const { firefox } = require('playwright-core')`
  3. `const fromOptions = await launchOptions({ headless: true|false, data_dir: <profileDir>, ... })`
  4. `const context = await NewBrowser(firefox, headless, fromOptions, false, false, { data_dir: <profileDir>, ... })`

### Attach/reuse mechanism (CDP-equivalent) conclusion
- No Camoufox-level attach/reuse contract equivalent to current Chromium `connectOverCDP` was found.
- Firefox does not provide a practical CDP reuse path for this architecture.
- Validation:
  - `firefox.connectOverCDP(...)` exists in API surface but returns: `Connecting over CDP is only supported in Chromium.`
- Therefore: no viable cross-process “attach to existing Camoufox context” path comparable to current CDP model.

## 2) Browser-owner lifetime decision + implementation

### Decision
- Chosen path: **single-owner process is the safe default**.
- One-shot CLI controller commands should **attach to existing owner** and must **not self-launch**.

### Why
- Without a CDP-equivalent in Camoufox/Firefox, self-launch in one-shot commands would create owner churn.
- Existing `runController(...){ finally shutdown(); }` is dangerous if self-launch remains possible.

### Implemented guardrails
- Added attach-only mode for one-shot CLI controller commands:
  - `cli.mjs` now sets `CHATGPT_MCP_ATTACH_ONLY=1` inside `runController`.
  - `browser-controller.mjs/getContext()` now:
    - tries attach first (`tryConnectCDP`)
    - if attach fails and `CHATGPT_MCP_ATTACH_ONLY=1`, throws:
      - `no_shared_browser_owner: launch the browser owner first ('exocortex-chatgpt launch')`
    - only self-launches when attach-only is not active.
- `shutdown()` is still called by one-shot CLI commands to cleanly release the attached session handle.

## 3) CHATGPT_MCP_HOME normalization (implemented)

### New shared runtime path module
- Added `runtime-paths.mjs` with:
  - `getHome()`
  - `getProfileDir()`
  - `getCDPFilePath()`
  - `getImagesDir()`
  - `getRequestsDir()`
  - `getResponsesDir()`
  - `getDaemonPidPath()`
  - `getTokenPath()`

### Updated files
- `launcher.mjs` now uses shared home/profile/cdp helpers (no hardcoded `~/.chatgpt-mcp`).
- `http-api.mjs` now uses shared home/token helpers.
- `mailbox.mjs` now uses shared requests/responses/images/daemon pid helpers.
- `browser-controller.mjs` now uses shared profile/cdp/images helpers.

## 4) Camoufox binary provisioning (implemented)

- Installed dependency: `camoufox`.
- Added bootstrap script: `scripts/camoufox-bootstrap.mjs`.
  - Uses CJS interop (`createRequire`) to avoid ESM import failure.
  - Detects installed binary via `getLaunchPath()`.
  - Runs `npx camoufox fetch` if missing.
  - Supports opt-out with `CHATGPT_MCP_SKIP_CAMOUFOX_FETCH=1`.
- `package.json` updates:
  - `"camoufox:fetch": "npx camoufox fetch"`
  - `"postinstall": "node scripts/camoufox-bootstrap.mjs"`
  - included script in package `files`.

## 5) Off-screen launch on macOS (spike findings)

### What was tested
- Firefox/Camoufox CLI help inspected from installed binary.
  - No `--window-position` option exists.
- Headed Playwright/Camoufox launch in this tmux environment hung (likely no usable GUI session here), so direct Playwright focus verification was not reliable in this session.
- macOS app-level no-focus launch tested successfully:
  - `open -g -a "/Users/fredluz/Library/Caches/camoufox/Camoufox.app" --args --new-window about:blank`
  - Frontmost app before/after remained unchanged (`Google Chrome`).

### Conclusion for migration
- Chromium-style `--window-position=-2000,-2000` does not map cleanly to Firefox CLI.
- On macOS, **`open -g` is the validated no-focus mechanism** for app launch.
- For direct Playwright-launched Firefox contexts, no proven “off-screen without focus steal” flag equivalent was validated in this environment.

## Verification run
- `npm test` passes after changes: **49/49**.
