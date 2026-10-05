# Vendored image renderer for /margin/card

Pages deploys this repo with no build step, so the share-image renderer is
committed pre-bundled. Nothing here is modified source.

| File | What it is | Source | License |
|---|---|---|---|
| `og-render.js` | esbuild bundle of `og-render.entry.js` (satori 0.15.2 wasm build, yoga-wasm-web 0.3.3 JS glue, @resvg/resvg-wasm 2.4.0 JS glue) | npm | satori MPL-2.0, resvg-wasm MPL-2.0, yoga-wasm-web MIT; bundled deps listed in `og-render.LEGAL.txt` |
| `yoga.wasm` | `yoga-wasm-web@0.3.3/dist/yoga.wasm` | npm | MIT |
| `resvg.wasm` | `@resvg/resvg-wasm@2.4.0/index_bg.wasm` | npm | MPL-2.0 |

Source for the MPL-2.0 parts: https://github.com/vercel/satori and
https://github.com/yisibl/resvg-js, at the versions above.

Rebuild:

```sh
npm i satori@0.15.2 @resvg/resvg-wasm@2.4.0 yoga-wasm-web@0.3.3 esbuild
npx esbuild og-render.entry.js --bundle --format=esm --platform=neutral \
  --main-fields=module,main --minify --legal-comments=external --outfile=og-render.js
cp node_modules/yoga-wasm-web/dist/yoga.wasm node_modules/@resvg/resvg-wasm/index_bg.wasm .  # rename the latter to resvg.wasm
```

The .wasm files are imported as modules (`import m from "./x.wasm"`) because
Workers cannot compile WebAssembly from bytes at runtime.
