# BlotBench Studio

BlotBench Studio is a local-first web app for Western blot, Dot blot, and gel image layout with semi-quantification.

The runnable application lives in `work/app`, but this README is the user-facing manual for the GitHub project homepage.

## What This Tool Is For

BlotBench Studio is designed to reduce the usual split workflow across:

- ImageJ for grayscale quantification
- Excel for normalization
- GraphPad for plotting
- PowerPoint / Illustrator for figure assembly

The current version focuses on:

- uploading blot or gel images in the browser
- drafting lanes and band ROIs
- moving target-band and loading-control detection boxes
- computing simple semi-quantification
- exporting a publication-style board

## What Image You Should Upload

The current version works best when you upload:

- one full blot panel or one sufficiently large crop
- all sample lanes visible in the same left-to-right order
- the target band region and the loading-control region both present in that same uploaded panel

Best-fit input examples:

- one membrane image where the target protein and loading control are at different molecular weights but share the same lane order
- one vertically stacked panel assembled from the same sample order

Not ideal for the current version:

- target blot only, with no loading-control region visible
- loading-control blot only
- target image and loading-control image from different membranes without external alignment
- screenshots or crops where lane order is inconsistent

## What The Colored Boxes Mean

Inside each lane:

- dashed blue frame = lane range for one sample
- short amber box = target protein detection region
- short teal box = loading-control detection region

These are not two different algorithms.
They are two different ROIs used inside the same lane geometry.

## Important Experimental Assumption

This matters a lot:

The current normalization only makes quantitative sense when the target region and the loading-control region correspond to the same lane order.

That means one of these situations should be true:

1. The target protein and loading control are both visible in one membrane image.
2. They were assembled into one panel externally, while preserving lane order.

If your target and loading control come from two unrelated images, different membranes, or different lane spacings, the current app should not be trusted as direct normalization automation yet.

In that case, the safer workflow is:

1. Align or assemble the target and loading-control images externally.
2. Preserve the same lane order.
3. Upload the combined panel into BlotBench Studio.

## Basic Operation Guide

1. Upload a TIFF, JPG, or PNG image.
2. Choose assay mode:
   - `Western blot`
   - `Dot blot`
   - `Gel band`
3. Adjust these controls on the right:
   - `Lane count`: number of sample lanes
   - `Lane width`: overall lane width
   - `Lane height`: overall lane height
   - `Target row`: vertical position for the target-band ROI
   - `Loading control row`: vertical position for the loading-control ROI
   - `Band height`: height of the short detection boxes
   - `Background offset`: distance between each band ROI and its background sampling areas
   - `Brightness trim`: display-only brightness adjustment
   - `Contrast trim`: display-only contrast adjustment
   - `Invert panel`: invert image display for easier visual alignment
4. In the image workbench:
   - drag the short amber box onto the target band
   - drag the short teal box onto the loading-control band
   - keep both boxes inside the correct lane
5. Check the sample sheet and group labels on the left.
6. Inspect normalized values and diagnostics before trusting the result.
7. Export CSV, SVG, or PDF if the values look correct.

## Why A Lane Can Show `0.000`

If a lane shows `0.000`, the most common reason is not “the app is random”.
It usually means one of these happened:

1. The target ROI is not actually covering the band.
   Then the measured target signal is close to background.

2. The target band is very weak.
   After background subtraction, the corrected target density becomes `0`.

3. The target ROI is partly on background and partly on the band.
   This can make `(target mean - target background)` less than or equal to `0`.

4. The loading-control ROI is misplaced or extremely weak.
   This can distort the ratio in the opposite direction and create abnormal highs or lows.

The current quantification logic is:

- `target_density = max(0, target_mean - target_background) * target_area`
- `reference_density = max(0, reference_mean - reference_background) * reference_area`
- `normalized_value = target_density / reference_density`

So if `target_mean <= target_background`, the target density becomes `0`, and the displayed normalized value will also become `0.000`.

## How To Judge Whether Your ROI Placement Is Reasonable

Good placement:

- the amber box sits directly on the real target band
- the teal box sits directly on the real loading-control band
- both boxes remain inside the correct lane
- nearby blank background still exists above and below the bands

Suspicious placement:

- the box is centered on a blank white area
- the box is much taller than the band itself
- the box crosses two lanes
- the loading-control box is placed where no real control band exists

## Current Limitation

The current version is still a single-panel lane-geometry workflow.

It does not yet fully support:

- separate target-image upload plus separate loading-control-image upload as a paired workflow
- automatic registration across two different blot images
- explicit warnings in the UI when `target_density` is zero because background subtraction dominated

## Project Structure

- root `README.md`: GitHub homepage manual
- `work/app`: runnable Vite + React application
- `.github/workflows/deploy-pages.yml`: GitHub Pages deployment

## Local Development

```bash
cd work/app
npm install
npm run dev
```

## Validation

```bash
cd work/app
npm run lint
npx vitest run
npm run build
```

## Deployment

This repository already includes a GitHub Pages workflow:

- `.github/workflows/deploy-pages.yml`

The app-specific runtime notes still live in:

- `work/app/README.md`
