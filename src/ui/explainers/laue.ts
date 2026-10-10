/**
 * Station "laue" — 3DMN (34-ID-E): polychromatic Laue micro-diffraction + differential-aperture X-ray
 * microscopy (DAXM). Two hands-on parts:
 *   1. "Laue pattern": one Ni (fcc) or Si (diamond) grain under the 5.3–30 keV pink beam; drag to rotate,
 *      compare rainbow vs one colour (monochromator), and apply deviatoric vs hydrostatic strain.
 *   2. "Depth (wire scan)": side view of the 45° sample with two grains along the beam and a scanned Pt
 *      wire; the pixel intensity vs wire position triangulates depth.
 * Physics, equations, numbers and sources: ./laue/physics.ts (full header comment). In brief:
 *   Laue condition   k_out = k_in + G_hkl, |k_out| = |k_in|  ⇒  λ = 2 d sinθ,  sinθ = −k̂_in·Ĝ,  E = hc/λ
 *   Spot direction   k̂_out = k̂_in + 2 sinθ Ĝ  (depends on Ĝ only: harmonics n·hkl overlap; a pure
 *                    dilatation moves nothing — only the deviatoric strain shows in spot positions)
 *   Extinction       fcc (Ni): h,k,l unmixed; diamond (Si): all odd, or all even with h+k+l = 4n
 *   Intensity        S(E)·λ²|F|²e^{−2Bs²}·P/sin²θ × 1/[μ(E)(1 + sinα_in/sinα_out)]  (kinematic, thick crystal;
 *                    S per unit energy ⇔ the usual i(λ)·λ⁴/(2sin²θ) with i per unit wavelength)
 *   Geometry         34-ID-E: beam ∥ +Z, X̂-polarised, 45° sample, 409.6 mm detector 510.9 mm above (2θ 68–112°)
 *   Mono             Si(111) ΔE/E ≈ 1.3×10⁻⁴; reflection window ΔE/E ≈ Δθ·cotθ (Δθ ≈ 1 mrad, illustrative)
 *   DAXM             depth s where the pixel→wire-edge tangent meets the beam (exact finite-distance
 *                    geometry); ds/dH = (1 − cot2θ)/√2; ΔI between wire steps → that depth bin
 *                    (Larson, Yang, Ice, Budai & Tischler, Nature 415, 887 (2002)).
 * Instrument numbers come from the 3DMN research dossier (APS-U FDR 2019, PDR 2017, Gürsoy et al. 2022,
 * lauelab geometry files, Larson et al. 2002); illustrative elements (pink-beam spectrum shape, mono
 * acceptance, photon counts) are labelled as such in the specialist text.
 */
import type { ExplainerModule } from './registry';
import { createStation, loop, toggle } from './kit';
import { createPattern, type PartApi } from './laue/pattern';
import { createDaxm } from './laue/daxm';
import { injectStyle, div } from './laue/common';

type PartId = 'pattern' | 'daxm';

const mod: ExplainerModule = {
  title: 'A rainbow of X-rays maps a crystal in 3D',
  subtitle: 'Turn a crystal in a rainbow X-ray beam, strain it, then sweep a wire to find how deep each grain lies.',
  mount(host, ctx) {
    const station = createStation(host, { depth: ctx.depth, color: ctx.color, layout: 'side' });
    station.root.classList.add('laue-root');
    injectStyle(station.root);

    let current: PartId = 'pattern';
    let lastCap = ['', ''];
    let ready = false;
    // captions change continuously during scans: throttle DOM updates to ~5 Hz (trailing update guaranteed)
    let capTimer = 0;
    let lastCapT = 0;
    const refreshCaption = () => {
      if (!ready) return;
      const now = performance.now();
      if (now - lastCapT < 180) {
        if (!capTimer)
          capTimer = window.setTimeout(() => {
            capTimer = 0;
            refreshCaption();
          }, 190);
        return;
      }
      lastCapT = now;
      const part = current === 'pattern' ? pattern : daxm;
      const [v, s] = part.caption();
      if (v === lastCap[0] && s === lastCap[1]) return;
      lastCap = [v, s];
      station.setCaption(v, s);
    };
    // The caption only ever grows within a part/depth/width: a shrinking caption would resize every canvas
    // (re-allocating backing stores) several times a second while a scan runs. Observed (no forced layout).
    let capMin = 0;
    const capRo = new ResizeObserver(() => {
      const ch = station.caption.getBoundingClientRect().height;
      if (ch > capMin + 0.5) {
        capMin = Math.ceil(ch);
        station.caption.style.minHeight = `${capMin}px`;
      }
    });
    capRo.observe(station.caption);
    const resetCaptionHeight = () => {
      capMin = 0;
      station.caption.style.minHeight = '';
    };

    // tab bar inside the visual grid (spans all columns)
    const tabs = div('laue-tabs', station.visual);
    toggle(tabs, {
      options: [
        { value: 'pattern', label: '① Laue pattern', title: 'Orientation & strain from a rainbow-beam spot pattern' },
        { value: 'daxm', label: '② Depth: the wire scan', title: 'Differential-aperture X-ray microscopy (DAXM)' },
      ],
      value: current,
      onChange: (v) => show(v as PartId),
    });

    const pattern: PartApi = createPattern(station, ctx.color, refreshCaption);
    const daxm: PartApi = createDaxm(station, ctx.color, refreshCaption);
    station.visual.append(pattern.el, daxm.el);
    ready = true;
    station.controls.append(pattern.ctl, daxm.ctl);

    function show(p: PartId): void {
      current = p;
      pattern.setActive(p === 'pattern');
      daxm.setActive(p === 'daxm');
      lastCap = ['', ''];
      lastCapT = 0;
      resetCaptionHeight();
      refreshCaption();
    }

    // responsive layout: switch on the HOST width (the station also lives in a ~450 px side panel)
    let narrow: boolean | null = null;
    let lastW = -1;
    const applyLayout = () => {
      const w = host.getBoundingClientRect().width;
      if (Math.abs(w - lastW) < 0.5) return;
      lastW = w;
      const n = w < 780;
      if (n !== narrow) {
        narrow = n;
        station.root.classList.toggle('stn-stack', n);
        station.root.classList.toggle('stn-side', !n);
        const vs = station.visual.style;
        vs.gridTemplateColumns = 'minmax(0,1fr)';
        vs.gridTemplateRows = n ? 'auto auto' : 'auto minmax(0,1fr)';
        // narrow: let the visual and the controls take their content height (the root scrolls if the host is fixed)
        vs.minHeight = n ? 'min-content' : '600px';
        station.controls.style.minHeight = n ? 'min-content' : '';
        // 'auto' rows get squeezed to a fixed-height host; max-content keeps every block whole
        station.root.style.gridTemplateRows = n ? 'max-content max-content max-content' : '';
      }
      resetCaptionHeight();
      // visual padding is 8 px each side
      const inner = w - 16;
      pattern.layout(n, inner);
      daxm.layout(n, inner);
    };
    const ro = new ResizeObserver(applyLayout);
    ro.observe(host);
    applyLayout();
    station.onDestroy(() => {
      ro.disconnect();
      capRo.disconnect();
      if (capTimer) clearTimeout(capTimer);
    });

    show('pattern');
    loop(station, (dt) => {
      if (current === 'pattern') pattern.frame(dt);
      else daxm.frame(dt);
    });

    return {
      destroy: () => station.destroy(),
      setDepth: (d) => {
        station.setDepth(d);
        pattern.depthChanged();
        daxm.depthChanged();
        lastCap = ['', ''];
        lastCapT = 0;
        resetCaptionHeight();
        refreshCaption();
      },
    };
  },
};
export default mod;
