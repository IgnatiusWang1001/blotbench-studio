# BlotBench Studio

BlotBench Studio is a local-first Western blot / Dot blot / gel-layout workbench for:

- raw TIFF / JPG / PNG upload
- lane drafting and ROI alignment
- target-band and loading-control positioning
- semi-quantification and normalization
- CSV / SVG / PDF figure export
- publication-board composition in the browser

This project is meant to reduce the usual split workflow across ImageJ, Excel, GraphPad, and presentation software.

## What The Two Short Boxes Mean

In Western blot mode, the app shows two short detection boxes inside each lane:

- `Short amber box` = target protein detection region
- `Short teal box` = loading-control detection region

They are not two different algorithms. They are two different ROIs inside the same lane layout.

The current quantification model assumes:

- one lane corresponds to one sample
- one short ROI measures the target band
- another short ROI measures the loading-control band
- the displayed normalized value is `target corrected density / loading-control corrected density`

## Important Experimental Interpretation

You raised the key point correctly: in many real Western blot workflows, the target protein and the loading control are not literally visible in the same cropped strip at the same time.

That can happen in several ways:

1. The target and loading control are from the same membrane, but at different molecular weights.
   In this case, they may appear in one full membrane image, only at different vertical positions.
   This is the best-fit use case for the current app.

2. The target and loading control are from the same sample lanes, but were exposed as separate images.
   For example, you probed the same membrane twice, or captured target and loading control separately.
   This is common, but the current version does not yet fully model it as two linked images.

3. The target and loading control are from different membranes, different gels, or not lane-aligned.
   In this case, they should not be treated as two short boxes inside one single imported panel.

So the current version is best suited for:

- one image containing the same lane order across target and loading control regions
- or one membrane image where target and loading control are vertically separated but still belong to the same lane geometry

The current version is not yet ideal for:

- target blot and loading-control blot uploaded as two unrelated images
- membranes with different lane spacing between target and control
- experiments where normalization should be computed across separately registered images

## What Kind Of Image You Should Upload

For the current workflow, the recommended input is:

- a full blot image or a sufficiently large crop
- all sample lanes visible in one image
- target and loading-control bands corresponding to the same lane order
- moderate contrast, with visible background around the bands

Recommended:

- same lane order from left to right
- target band region and loading-control band region both present in the same uploaded panel
- enough blank margin above and below the bands for local background estimation

Not recommended for the current version:

- an already tightly cropped strip containing only the target band but no loading control
- target blot and loading-control blot from unrelated screenshots pasted into one canvas
- images where the lane order changes between target and control
- images where one ROI would have to point to a completely different membrane

## If Your Target And Loading Control Are In Different Images

If your experiment generated:

- `image A` = target protein
- `image B` = loading control

and they are not already part of one lane-aligned panel, then the current app should be treated as a layout / ROI drafting aid, not as fully reliable normalization automation.

For now, the safer workflow is:

1. Make sure both images correspond to the same sample order.
2. Align or assemble them into one vertically stacked panel outside the app, keeping lane order unchanged.
3. Upload that stacked panel so the amber ROI and teal ROI each map to the correct row.

This limitation should be stated clearly: current normalization assumes one shared lane geometry.

## Basic Workflow

1. Upload a raw TIFF, JPG, or PNG panel.
2. Choose assay mode:
   - `Western blot`
   - `Dot blot`
   - `Gel band`
3. Adjust:
   - `Lane count`
   - `Lane width`
   - `Lane height`
4. In the workbench:
   - dashed blue frame = lane range
   - short amber box = target-band detection region
   - short teal box = loading-control detection region
5. Drag the short amber or teal box vertically or horizontally until it sits on the real band.
6. Check the sample sheet and group labels.
7. Review normalized values before trusting any unusually high ratio.
8. Export CSV, SVG, or PDF.

## How The Current Quantification Is Calculated

For each lane:

1. The app samples the mean signal inside the target ROI.
2. It samples local background above and below that ROI.
3. It computes target corrected density:

`target_density = max(0, target_mean - target_background) * target_area`

4. It does the same for the loading-control ROI:

`reference_density = max(0, reference_mean - reference_background) * reference_area`

5. It reports:

`normalized_value = target_density / reference_density`

If no valid loading-control signal is found, the current version falls back to raw corrected target density.

## Why A Lane Can Become Artificially Very High

A lane can look falsely high when:

- the loading-control ROI is misplaced
- the loading-control band is extremely weak
- the loading-control background is overestimated
- the denominator becomes very small

This means a large ratio does not automatically mean a strong biological effect.

When a lane value looks suspiciously high:

1. Check whether the teal box is actually on the loading-control band.
2. Check whether the amber box and teal box belong to the same sample lane.
3. Check whether the uploaded panel really contains a valid target/control pair for that lane.

## Current Product Scope

Current strengths:

- local-first image handling
- fast lane drafting
- manual ROI repositioning
- lightweight publication-board export

Current limitations:

- no full multi-image target/control registration workflow yet
- no dedicated “target image + loading-control image” paired import flow yet
- normalization assumes shared lane geometry inside one uploaded panel

## Run Locally

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

## Validation

```bash
npm run lint
npx vitest run
```

## Install Like A Desktop App

This project is configured as a PWA.

After deployment or local preview:

```bash
npm run serve:dist
```

Open the app in a Chromium-based browser and use the browser's `Install app` action.

## Deploy To GitHub Pages

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
