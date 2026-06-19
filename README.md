# BlotBench Studio

BlotBench Studio is a local-first web app for Western Blot, Dot Blot, and gel image layout with semi-quantification.

The application source lives in `work/app`.

Core capabilities:

- raw TIFF, JPG, and PNG upload
- auto lane and band drafting
- ROI correction in-place
- target/reference normalization
- significance annotation
- multi-panel publication board export
- PWA install for desktop-style use

Local development:

```bash
cd work/app
npm install
npm run dev
```

Deployment:

- GitHub Pages workflow: `.github/workflows/deploy-pages.yml`
- App-specific deployment notes: `work/app/README.md`
