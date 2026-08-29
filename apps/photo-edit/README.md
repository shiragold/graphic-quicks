# photo-edit

Browser-based auto-crop / deskew for scanned photos, powered by OpenCV.js.

- UI: [index.html](./index.html)
- Image-processing logic: [`@graphic-quicks/photo-edit`](../../packages/photo-edit/),
  imported directly from its built output
  (`../../packages/photo-edit/dist/index.js`) via `<script type="module">`.

Open `index.html` directly in a browser (or serve the repo root) — no build
step for the app itself. The package must be built first
(`pnpm --filter @graphic-quicks/photo-edit build`) so `dist/` exists.

OpenCV.js is loaded from the CDN by a classic `<script>` tag in
`index.html`; the app waits for `Module.onRuntimeInitialized` before calling
any package function, which is when the ambient `cv` global the package
relies on becomes available.

## Tests

The test suite lives with the package: `packages/photo-edit/tests/`.

```bash
pnpm --filter @graphic-quicks/photo-edit test
pnpm --filter @graphic-quicks/photo-edit fixtures  # dump fixture PNGs for eyeballing
```
