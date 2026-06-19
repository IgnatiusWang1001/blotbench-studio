# BlotBench Studio

BlotBench Studio is a local-first Western Blot / Dot Blot / gel workflow for:

- raw image upload, including TIFF
- auto lane and band drafting
- ROI correction in-place
- semi-quantification and normalization
- significance annotation
- multi-panel publication board export

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

The production files are emitted to `dist/`.

If you are deploying under a subpath such as GitHub Pages, set a base path first:

```bash
$env:VITE_BASE_PATH='/your-repo-name/'
npm run build
```

On macOS/Linux:

```bash
VITE_BASE_PATH=/your-repo-name/ npm run build
```

## Install like a desktop app

This project is configured as a PWA.

After deployment or local preview:

```bash
npm run serve:dist
```

Open the app in a Chromium-based browser and use the browser's `Install app` action.
That gives you a standalone desktop-style window without adding Electron or a native runtime.

The app surface also exposes an in-product `Install app` button when the browser fires the install prompt.

## Validation

```bash
npm run lint
npx vitest run
```

## Deploy to GitHub Pages

This repo already includes a Pages workflow at `.github/workflows/deploy-pages.yml`.

1. Push the project to a GitHub repository with `main` as the default branch.
2. In GitHub, open `Settings -> Pages`.
3. Set `Source` to `GitHub Actions`.
4. Push to `main` or manually run the workflow.

The workflow will:

- install dependencies from `work/app`
- run lint
- run Vitest
- build with `VITE_BASE_PATH=/<repo-name>/`
- publish `work/app/dist` to GitHub Pages
