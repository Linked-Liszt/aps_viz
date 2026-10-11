import * as THREE from 'three';
import { Stage, type Pickable } from '../scene/Stage';
import { Site } from '../scene/site/Site';
import { BeamlineScene } from '../scene/beamline/BeamlineScene';
import { store, sameView, viewToHash, type Quality, type View } from './store';
import { FEATURE_META, metaById } from '../data/meta';
import { sectorFrame, alongBeam, SITE, toWorld } from '../data/site';
import { setLineResolution } from '../scene/lines';
import { h, icon, nodes, prefersReducedMotion } from '../lib/dom';
import { SECTOR_INFO, type SectorBeamline } from '../data/sectors';
import { BEAMLINES } from '../data/beamlines';
import { layoutFor, loadLayouts } from '../beamlines';
import { compBranch, DEFAULT_LAYOUT, type BeamlineLayout } from '../scene/beamline/layout';
import { TopBar } from '../ui/TopBar';
import { featureCardText, OverviewPanel } from '../ui/OverviewPanel';
import { BeamlinePanel, formatDist, stripRefs } from '../ui/BeamlinePanel';
import { PathStrip } from '../ui/PathStrip';
import { Modal, openExplainerModal } from '../ui/Modal';
import { buildIntro, openHelp, openStory, TourCard } from '../ui/Overlays';
import { hasWelcome, openAuthorNote, openWelcome } from '../ui/Author';
import { TOUR, type TourShot } from '../data/tour';
import { componentKind } from '../ui/categories';
import { Search } from '../ui/Search';
import { clamp, ease } from '../lib/tween';
import type { Beamline, BeamlineMeta } from '../data/types';
import { ShaderPreparation } from './ShaderPreparation';

const BUILDING_NOTES: Record<string, string> = {
  lom: 'Lab/Office Modules contain offices, laboratories and user support space for neighbouring sectors.',
  'long-beamline-building': 'The Long Beamline Building opened in 2022 for the APS Upgrade. It contains the end stations of ISN at 19-ID and HEXM at 20-ID, whose beamlines are about 200 m long.',
  injector: 'Part of the injector complex, where electrons are accelerated before injection into the storage ring.',
  office: 'APS offices, control room and conference space.',
  neighbour: 'Neighbouring Argonne user facility.',
};

/**
 * Sectors 36–40 hold accelerator systems instead of user beamlines. Only the RF straights (36, 37, 40) are confirmed
 * as built; the bunch-lengthening cavity (38) and injection (39) follow the 2019 final design report, whose
 * placements were not confirmed after the move to single-straight injection (research: facility.json).
 * `text` is the one sector-card text for every reader: what is there and what it does, then the precise caveat.
 */
const RF_STRAIGHT = {
  short: 'Four radio-frequency accelerating cavities',
  text: 'Four of the ring\'s 12 radio-frequency accelerating cavities are in this straight section. Their 352 MHz electric field restores the energy each electron loses as light on every lap. The loss is about 2.9 to 4.5 MeV, depending on how many undulator gaps are closed. The 12 single-cell copper cavities are arranged in groups of four in sectors 36, 37 and 40.',
};
const MACHINE_SECTORS: Record<number, { short: string; text: string }> = {
  36: RF_STRAIGHT,
  37: RF_STRAIGHT,
  38: {
    short: 'Bunch-lengthening cavity in the 2019 design',
    text: 'The 2019 Final Design Report places a superconducting bunch-lengthening cavity in this straight section, alongside fast magnets that extract bunches from the ring. Passing bunches excite the cavity at 1.4 GHz, four times the main radio frequency. The cavity lengthens each bunch so electrons collide less often and the stored beam lasts longer. Its installed location is unconfirmed.',
  },
  39: {
    short: 'Injection in the 2019 design',
    // the 2019 design injected vertically through a DC Lambertson septum; the pulsed septum came with the 2021 change
    // to horizontal injection (research: facility.json swapOut.plane)
    text: 'The 2019 Final Design Report places injection in this straight section. Fresh electron bunches from the booster replace depleted bunches in a process called swap-out. The design used vertical injection through a steady-field Lambertson septum and kicker magnets. The septum steers the incoming beam beside the stored beam, and the design places the dump inside the A:M1 magnet. The installed system injects horizontally through a pulsed septum and three stripline kickers in one straight section. The booster transfer line enters at the straight section shown here, but the sector containing the installed injection system is unconfirmed.',
  },
  40: RF_STRAIGHT,
};

/** Expand XSD to X-ray Science Division in the operator description. */
function operatorsText(s: string): string {
  return s.replace(/\bXSD\b/, 'X-ray Science Division, XSD');
}

/** Directory titles that only restate the sector ("Sector 10 - Bending Magnet Beamline") say nothing on a card. */
const GENERIC_TITLE = /Sector \d+\s*[-–]\s*(Bending Magnet|Insertion Device) Beamline/i;

function firstSentence(s: string | undefined): string {
  if (!s) return '';
  const m = /^(.+?[.!?])(\s|$)/.exec(s.trim());
  return (m ? m[1] : s).trim();
}

/** One-line description of a sector beamline for the hover card. */
function beamlineBlurb(b: SectorBeamline): string {
  const t = (b.title ?? '').replace(/^[^:]*:\s*/, '');
  if (t && !GENERIC_TITLE.test(t)) return t;
  return firstSentence(stripRefs(b.summary ?? '')) || (b.techniques ?? []).slice(0, 2).join(', ');
}

/** Card heading of a sector beamline: its directory title unless that is generic. */
function beamlineHeading(b: SectorBeamline): string {
  return b.title && !GENERIC_TITLE.test(b.title) ? b.title : b.name;
}

/**
 * Components that get a place in the 3D model, in dossier order (the rule BeamlineScene.buildComponents applies: not
 * hidden by the layout, with a known distance). Lets the panel, strip and keys work before the scene is built.
 */
function placedIds(data: Beamline, layout: BeamlineLayout): string[] {
  return data.components
    .filter((c) => {
      const o = layout.comp?.[c.id];
      const d = o?.distanceM ?? c.distanceM;
      return !o?.hidden && d !== null && d !== undefined && Number.isFinite(d);
    })
    .map((c) => c.id);
}

/** Station tag for a feature beamline: '8-ID', or the station letters where two beamlines share a sector. */
function stationTag(m: BeamlineMeta): string {
  const shared = FEATURE_META.some((o) => o.id !== m.id && o.sectorNumber === m.sectorNumber);
  return shared && !m.stations.includes(',') ? m.stations : `${m.sectorNumber}-ID`;
}

const IS_TEST = typeof location !== 'undefined' && /[?&]test\b/.test(location.search);
/** Shadow-map refresh rate while a beamline is open (layouts may animate parts; the rest of the time: on request). */
const BEAMLINE_SHADOW_HZ = 4;
/** Elements whose keys belong to them, not to the app's single-key shortcuts. */
const OWN_KEYS = '.station-host, .stn, .popover, .modal, .search';
const STATION = '.station-host, .stn';

/**
 * Update the 3D stage and exhibit UI to match the routed View.
 */
export class App {
  readonly stage: Stage;
  readonly site: Site;
  private bl: BeamlineScene | null = null;
  private topbar = new TopBar();
  private overview = new OverviewPanel();
  private panel = new BeamlinePanel();
  private strip = new PathStrip();
  private tour = new TourCard();
  private modal = new Modal();
  private search = new Search();
  private hovercard: HTMLElement;
  private hoverSize: { w: number; h: number } | null = null;
  private pointerAt = { x: 0, y: 0 };
  private sectorCard: HTMLElement;
  private intro: HTMLElement | null = null;
  private ride: { cancel: () => void } | null = null;
  private rideRequested = false;
  private frameCount = 0;
  /** resolves once the per-beamline layouts have loaded (never rejects) */
  private ready: Promise<void> = Promise.resolve();
  private layoutsReady = false;
  /** the view currently shown (the store may already hold a newer one that is waiting for the layouts) */
  private applied: View | null = null;
  /** Requested beamline whose scene is still being prepared. */
  private pendingBuild: string | null = null;
  private buildRequest = 0;
  private buildAbort: AbortController | null = null;
  /** Keep the outgoing model on screen until the next one is ready. */
  private previousBeamline: BeamlineScene | null = null;
  /** At most two completed models, including the open one. */
  private sceneCache = new Map<string, BeamlineScene>();
  /** View that opened the full-screen station. Navigation away from it closes the dialog. */
  private stationOwner: Extract<View, { mode: 'beamline' | 'tour' }> | null = null;
  /** Tour stop to return to while exploring a beamline during this visit. */
  private tourReturnStep: number | null = null;
  private insetsQueued = false;
  private shaderPreparation: ShaderPreparation | null = null;

  constructor(stageHost: HTMLElement, labelHost: HTMLElement, private ui: HTMLElement) {
    this.stage = new Stage(stageHost, labelHost);
    this.stage.setQuality(store.state.quality);
    this.site = new Site(this.stage);
    const syncLines = () => setLineResolution(stageHost.clientWidth, stageHost.clientHeight);
    syncLines();
    new ResizeObserver(syncLines).observe(stageHost);

    this.hovercard = h('div', { class: 'hovercard glass', role: 'tooltip' });
    // positioned (and kept inside the viewport) by placeHovercard
    this.hovercard.style.left = '0px';
    this.hovercard.style.top = '0px';
    this.sectorCard = h('section', { class: 'sector-card glass', 'aria-label': 'Sector', inert: true });
    this.ui.append(this.topbar.el, this.overview.el, this.panel.el, this.strip.el, this.tour.el, this.sectorCard, this.hovercard, this.modal.el, this.search.el);
    window.addEventListener(
      'pointermove',
      (e) => {
        this.pointerAt.x = e.clientX;
        this.pointerAt.y = e.clientY;
        if (this.hovercard.classList.contains('is-on')) this.placeHovercard();
      },
      { passive: true },
    );

    this.wireUi();
    this.wireStage();
    // wheel/pinch over a 3D label should still zoom the camera
    labelHost.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.stage.renderer.domElement.dispatchEvent(new WheelEvent('wheel', e));
      },
      { passive: false },
    );
    window.addEventListener('resize', () => {
      const v = store.state.view;
      if (v.mode === 'overview') this.overview.setVisible(!v.focus || window.innerWidth > 900);
      this.queueInsets();
    });
    new MutationObserver(() => this.queueInsets()).observe(this.overview.el, { attributes: true, attributeFilter: ['class'] });
    // bottom chrome changes height with its content (strip rows, tour stops, sector cards): keep camera framing above
    // it. (Side panels change width only with the window or a class toggle, both handled above.)
    const ro = new ResizeObserver(() => this.queueInsets());
    for (const el of [this.strip.el, this.tour.el, this.sectorCard]) ro.observe(el);
    // nothing behind a dialog needs rendering; a station modal also follows its beamline (see applyView)
    new MutationObserver(() => this.onModalToggle()).observe(this.modal.el, { attributes: true, attributeFilter: ['class'] });
    this.wireKeys();

    this.stage.onFrame((dt) => {
      this.site.update(dt, this.stage.time);
      this.bl?.update(dt);
      this.previousBeamline?.update(dt);
      if (++this.frameCount % 6 === 0) this.updateHud();
    });

    store.subscribe((s, prev) => {
      if (s.view !== prev.view) this.scheduleView();
      if (s.quality !== prev.quality) this.stage.setQuality(s.quality);
    });

    // overview pins go up at once from default geometry and are refined when the layouts arrive
    this.placeFeaturePins();
    this.wireFeaturePins();
    this.ready = loadLayouts()
      .then(() => {
        this.layoutsReady = true;
        this.initFeatures();
      })
      .catch((e) => console.error('feature beamline layouts could not be applied', e));
    this.scheduleView();

    // Only home entries show the opening dialog. Direct links open their requested view.
    const homeEntry = ['', '#', '#/'].includes(location.hash);
    const atHome = () => store.state.view.mode === 'overview' && !store.state.view.focus;
    const startIntro = () => {
      if (homeEntry && atHome() && !store.state.introSeen) this.showIntro();
    };
    const params = new URLSearchParams(location.search);
    if (homeEntry && hasWelcome() && (!params.has('test') || params.has('welcome'))) {
      // a dialog pauses rendering: wait until the opening view has been drawn so the facility shows behind the welcome
      // (the view is applied once the beamline layouts load; after 4 s the welcome opens regardless)
      const t0 = performance.now();
      let drawnFrom = -1;
      const whenDrawn = () => {
        // Do not interrupt a visitor who navigated or opened another overlay while the scene loaded.
        if (!atHome() || this.modal.isOpen || this.search.isOpen) return;
        if (this.applied && drawnFrom < 0) drawnFrom = this.frameCount;
        if ((drawnFrom >= 0 && this.frameCount - drawnFrom > 3) || performance.now() - t0 > 4000) {
          this.shaderPreparation ??= new ShaderPreparation(this.stage, this.ready, () => this.retainedScenes());
          openWelcome(
            this.modal,
            () => store.set({ introSeen: true }),
            () => store.go({ mode: 'tour', step: 0 }),
            this.shaderPreparation,
          );
        } else requestAnimationFrame(whenDrawn);
      };
      whenDrawn();
    } else startIntro();
    this.startGovernor();
  }

  /** Overview pin of each feature beamline, along its (canted / offset) beam. */
  private placeFeaturePins(): void {
    for (const m of FEATURE_META) {
      const b = BEAMLINES[m.id];
      const lay = layoutFor(m.id);
      const f = sectorFrame(m.sectorNumber, lay.cantMrad ?? 0);
      const pinAt = Math.min(48, (b?.totalLengthM ?? 60) * 0.7);
      this.site.setFeaturePin(m.id, alongBeam(f, pinAt, (lay.sideOffsetM ?? 0) + (m.id === 'atomic' ? 5 : 0), 9), b?.acronym ?? m.id.toUpperCase());
    }
  }

  private wireFeaturePins(): void {
    for (const m of FEATURE_META) {
      const pin = this.site.featurePinElement(m.id);
      pin?.addEventListener('click', () => store.go({ mode: 'beamline', id: m.id }));
      pin?.addEventListener('mouseenter', () => this.hotFeature(m.id));
      pin?.addEventListener('mouseleave', () => this.hotFeature(null));
    }
  }

  /** Overview models of the feature beamlines; needs the (lazily loaded) layouts. */
  private initFeatures(): void {
    this.placeFeaturePins();
    this.site.buildFeatureOverviewLines(FEATURE_META.map((m) => ({ meta: m, data: BEAMLINES[m.id], layout: layoutFor(m.id) })));
    const faces = new Map<number, number>();
    for (const m of FEATURE_META) {
      const f = layoutFor(m.id).ratchetFaceM;
      if (f !== undefined) faces.set(m.sectorNumber, f);
    }
    if (faces.size) this.site.buildRatchet(faces);
    // Do not add overview models in the sector of an already open beamline.
    if (this.bl?.group.visible) this.site.setFocus(this.bl.data.id, this.bl.meta.sectorNumber);
    this.stage.requestShadowUpdate();
    this.stage.invalidateLabels();
  }

  /**
   * Lower rendering quality one tier if the frame rate stays low. Restore a tier after sustained good frame rates,
   * up to the tier the session started with. Do not override an explicit user choice or save automatic changes.
   * Skip measurements while a dialog is open or a panel station is running, and briefly after either closes.
   * Station CPU load is excluded from the measurements used to adjust the 3D renderer.
   */
  private startGovernor(): void {
    if (IS_TEST) return;
    const tiers: Quality[] = ['low', 'balanced', 'high'];
    const ceiling = tiers.indexOf(store.state.quality);
    let frames = 0;
    let t0 = performance.now();
    let last = t0;
    let quietUntil = t0 + 8000; // shader compilation + the opening camera swoop
    let slow = 0;
    let fast = 0;
    let lastUpAt = -Infinity;
    let bounces = 0;
    this.stage.onFrame(() => {
      const now = performance.now();
      const gap = now - last;
      last = now;
      frames++;
      // a long gap means the loop stood still (paused behind a dialog, hidden tab): its first frames are no measure
      if (gap > 1000) quietUntil = Math.max(quietUntil, now + 1500);
      if (this.modal.isOpen || this.panel.el.querySelector('.stn')) quietUntil = Math.max(quietUntil, now + 5000);
      if (now < quietUntil) {
        frames = 0;
        t0 = now;
        slow = fast = 0;
        return;
      }
      if (now - t0 < 2500) return;
      const fps = (frames * 1000) / (now - t0);
      frames = 0;
      t0 = now;
      if (store.state.qualityChosen || document.hidden) {
        slow = fast = 0;
        return;
      }
      const q = tiers.indexOf(store.state.quality);
      slow = fps < 24 ? slow + 1 : 0;
      fast = fps >= 50 ? fast + 1 : 0;
      if (slow >= 3 && q > 0) {
        slow = fast = 0;
        if (now - lastUpAt < 60000) bounces++; // stepped up too eagerly: wait longer next time
        const next = tiers[q - 1];
        store.set({ quality: next });
        this.toast(`Switched to ${next === 'low' ? 'Light' : 'Balanced'} rendering because the frame rate was low. You can change the rendering setting in Display settings.`);
      } else if (q < ceiling && bounces < 3 && fast >= 8 * 2 ** bounces) {
        slow = fast = 0;
        lastUpAt = now;
        store.set({ quality: tiers[q + 1] });
      }
    });
  }

  private toast(msg: string): void {
    const t = h('div', { class: 'toast glass', role: 'status' }, msg);
    this.ui.appendChild(t);
    requestAnimationFrame(() => t.classList.add('is-on'));
    setTimeout(() => {
      t.classList.remove('is-on');
      setTimeout(() => t.remove(), 500);
    }, 5200);
  }

  // ---------------------------------------------------------------- wiring

  private wireUi(): void {
    this.topbar.onHome = () => this.goHome();
    this.topbar.onTour = () => this.startTour();
    this.topbar.onStory = () => this.openStory();
    this.topbar.onHelp = () => this.openHelp();
    this.topbar.onAuthor = () => openAuthorNote(this.modal);
    this.topbar.onSearch = () => this.search.open();
    this.overview.onHover = (id) => this.hotFeature(id);
    this.overview.onOpen = (id) => store.go({ mode: 'beamline', id });
    this.overview.onStory = () => this.openStory();
    this.overview.onTour = () => store.go({ mode: 'tour', step: 0 });
    this.panel.onClose = () => store.go({ mode: 'overview' });
    this.panel.onReturnToTour = () => {
      this.startTour();
      requestAnimationFrame(() => this.tour.focusNext());
    };
    // design-record figures open full size in the dialog (keyboard-accessible, no new tab in a kiosk)
    this.panel.onOpenFigure = (content, label) => this.modal.open(content, undefined, label);
    this.panel.onSelectComponent = (cid) => this.selectComponent(cid);
    this.panel.onExpandExplainer = (id) => {
      const v = store.state.view;
      if (v.mode === 'beamline') this.openStation(id, v.id);
    };
    this.strip.onSelect = (cid) => this.selectComponent(cid);
    this.strip.onOverview = () => {
      const v = store.state.view;
      if (v.mode !== 'beamline') return;
      if (v.component) store.go({ mode: 'beamline', id: v.id }, true);
      else this.frameBeamline();
    };
    this.strip.onRide = () => this.rideBeam();
    this.tour.onStep = (i) => store.go({ mode: 'tour', step: i }, true);
    this.tour.onExit = () => store.go({ mode: 'overview' });
    this.tour.onOpenBeamline = (id) => store.go({ mode: 'beamline', id });
    this.tour.onOpenStation = (id) => {
      const station = metaById(id)?.explainers[0];
      if (station) this.openStation(station, id);
    };
  }

  private startTour(): void {
    store.go({ mode: 'tour', step: this.tourReturnStep ?? 0 });
  }

  private openStation(id: string, beamlineId: string): void {
    const v = store.state.view;
    const m = metaById(beamlineId);
    this.stationOwner = v.mode === 'beamline' || v.mode === 'tour' ? v : null;
    openExplainerModal(this.modal, id, m?.color ?? '#5cd3ff', m?.id);
  }

  private wireStage(): void {
    this.stage.onHover = (info) => this.onHover(info);
    this.stage.onPick = (info) => this.onPick(info);
    this.stage.onUserCamera = () => this.stopRide();
    this.stage.pickFilter = (info) => this.isPickable(info);
  }

  private openStory(): void {
    this.stationOwner = null;
    openStory(this.modal);
  }

  private openHelp(): void {
    this.stationOwner = null;
    openHelp(this.modal);
  }

  private onModalToggle(): void {
    const open = this.modal.isOpen;
    this.stage.setPaused(open);
    if (!open) this.stationOwner = null;
  }

  /** Home (brand / crumb): the whole APS, re-framed even when the overview is already showing. */
  private goHome(): void {
    const was = store.state.view;
    store.go({ mode: 'overview' });
    if (was.mode === 'overview') this.overviewCamera();
  }

  /** Select a component of the open beamline; choosing the selected one again re-frames it. */
  private selectComponent(cid: string | null): void {
    const v = store.state.view;
    if (v.mode !== 'beamline') return;
    if ((cid ?? undefined) === v.component) {
      if (cid) {
        this.stopRide();
        this.focusComponent(cid, false);
      }
      return;
    }
    store.go({ mode: 'beamline', id: v.id, component: cid ?? undefined }, true);
  }

  private onPinClick(id: string, cid: string): void {
    const v = store.state.view;
    if (v.mode === 'beamline' && v.id === id) this.selectComponent(cid);
    else store.go({ mode: 'beamline', id, component: cid });
  }

  // ---------------------------------------------------------------- keyboard

  private wireKeys(): void {
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  /**
   * Global shortcuts. Keys a widget handled (defaultPrevented) or typed into a field are left alone; single-key
   * shortcuts never fire inside stations, popovers, dialogs or search; camera keys (arrows, +/−, PgUp/PgDn, Home)
   * only act when the 3D view or the page itself has focus, since many widgets use arrows.
   */
  private onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.isComposing) return;
    const searchOpen = this.search.isOpen;
    const modalOpen = this.modal.isOpen;
    let target = e.target instanceof Element ? e.target : null;
    // focus stuck in the closed search box (or anything else that went inert) counts as the page
    if (target && !searchOpen && this.search.el.contains(target)) target = null;
    const field = !!target && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target as HTMLElement).isContentEditable);

    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (searchOpen) this.search.close();
      else {
        // search navigates: never leave a dialog standing over the place it goes to
        if (modalOpen && !this.modal.close()) return;
        this.search.open();
      }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === 'Escape') {
      // backstops for focus that is not inside the open overlay (e.g. on the page body after a click)
      if (searchOpen) {
        e.preventDefault();
        this.search.close();
        return;
      }
      if (modalOpen) {
        e.preventDefault();
        this.modal.close();
        return;
      }
      if (field || target?.closest(STATION)) return; // a station may use Escape itself
      this.escape();
      return;
    }

    if (field) return;
    const inOwn = !!target?.closest(OWN_KEYS);
    if (modalOpen || searchOpen || inOwn) return;

    const canvas = this.stage.renderer.domElement;
    const onView = !target || target === canvas || target === document.body || target === document.documentElement;
    if (onView && !this.intro && this.cameraKey(e)) {
      e.preventDefault();
      return;
    }

    const v = store.state.view;
    if (e.key === '/') {
      e.preventDefault();
      this.search.open();
      return;
    }
    switch (e.key) {
      case '[':
      case ']':
        // only along the beamline that is showing: a deep link still waiting for the layouts may name no beamline
        if (v.mode === 'beamline' && v === this.applied) {
          const comps = placedIds(BEAMLINES[v.id], this.layoutOf(v.id));
          const i = v.component ? comps.indexOf(v.component) : -1;
          const j = e.key === ']' ? Math.min(comps.length - 1, i + 1) : Math.max(0, i - 1);
          if (comps[j] && comps[j] !== v.component) store.go({ mode: 'beamline', id: v.id, component: comps[j] }, true);
        }
        break;
      case 'f':
      case 'F':
        if (v.mode === 'beamline') this.frameBeamline();
        else this.overviewCamera();
        break;
      case 'r':
      case 'R':
        if (v.mode === 'beamline') this.rideBeam();
        break;
      case 't':
      case 'T':
        if (v.mode === 'tour') store.go({ mode: 'overview' });
        else this.startTour();
        break;
      case '?':
        this.openHelp();
        break;
      default:
        if (/^[1-9]$/.test(e.key)) {
          const m = FEATURE_META[Number(e.key) - 1];
          if (m) store.go({ mode: 'beamline', id: m.id });
        }
    }
  }

  /** Escape steps back one level: intro → selected component → sector card → overview. */
  private escape(): void {
    const v = store.state.view;
    if (this.intro) this.dismissIntro();
    else if (v.mode === 'beamline' && v.component) store.go({ mode: 'beamline', id: v.id }, true);
    else if (v.mode === 'overview' && v.focus) store.go({ mode: 'overview' }, true);
    else if (v.mode !== 'overview') store.go({ mode: 'overview' });
  }

  /** Arrow keys orbit, Shift+arrows pan, +/− and PgUp/PgDn zoom, Home re-frames. Returns whether the key was one. */
  private cameraKey(e: KeyboardEvent): boolean {
    const k = e.key;
    const step = 0.1;
    switch (k) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        const s = k === 'ArrowLeft' ? -1 : 1;
        if (e.shiftKey) this.stage.panBy(s * step, 0);
        else this.stage.orbitBy(-s * step, 0);
        return true;
      }
      case 'ArrowUp':
      case 'ArrowDown': {
        const s = k === 'ArrowUp' ? 1 : -1;
        if (e.shiftKey) this.stage.panBy(0, s * step);
        else this.stage.orbitBy(0, s * step);
        return true;
      }
      case '+':
      case '=':
      case 'PageUp':
        this.stage.zoomBy(0.2);
        return true;
      case '-':
      case '_':
      case 'PageDown':
        this.stage.zoomBy(-0.25);
        return true;
      case 'Home':
        this.frameCurrent();
        return true;
    }
    return false;
  }

  /** Put the camera back on the current view's own framing. */
  private frameCurrent(): void {
    const v = this.applied;
    if (!v) return;
    this.stopRide();
    if (v.mode === 'beamline') {
      if (v.component) this.focusComponent(v.component, false);
      else this.frameBeamline();
    } else if (v.mode === 'overview') {
      if (v.focus) this.flyToSector(Number(v.focus));
      else this.overviewCamera();
    } else {
      const step = TOUR[v.step];
      if (step) this.applyTourShot(step.shot);
    }
  }

  // ---------------------------------------------------------------- hover & pick

  /** What may be hovered and clicked in the current view. */
  private isPickable(info: Pickable): boolean {
    const mode = store.state.view.mode;
    switch (info.kind) {
      case 'component':
        // the open beamline's parts; in a tour beamline stop a click steps inside at that part
        return !!this.bl?.group.visible && (mode === 'beamline' || mode === 'tour');
      case 'feature':
        // whole feature beamlines only while no detailed beamline is open (they are faded behind one)
        return !this.bl && (mode === 'overview' || mode === 'tour');
      default:
        return mode === 'overview';
    }
  }

  private hotFeature(id: string | null): void {
    this.overview.setHot(id);
    for (const m of FEATURE_META) this.site.featurePinElement(m.id)?.classList.toggle('is-hot', m.id === id);
    this.site.highlightFeature(id);
  }

  private showHovercard(...children: (Node | string | null)[]): void {
    this.hovercard.replaceChildren(...nodes(...children));
    this.hovercard.classList.add('is-on');
    this.hoverSize = null;
    this.placeHovercard();
  }

  /** Next to the pointer, flipped to the other side near the right/bottom edges and kept 12 px inside the viewport. */
  private placeHovercard(): void {
    const el = this.hovercard;
    const sz = (this.hoverSize ??= { w: el.offsetWidth, h: el.offsetHeight });
    const M = 12;
    const G = 14;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const { x: px, y: py } = this.pointerAt;
    let x = px + G;
    let y = py + G;
    if (x + sz.w > W - M) x = px - G - sz.w;
    if (y + sz.h > H - M) y = py - G - sz.h;
    x = clamp(x, M, Math.max(M, W - M - sz.w));
    y = clamp(y, M, Math.max(M, H - M - sz.h));
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  private onHover(info: Pickable | null): void {
    const v = store.state.view;
    if (info?.kind === 'sector') {
      const n = Number(info.id);
      this.site.highlightSector(n);
      const feats = FEATURE_META.filter((m) => m.sectorNumber === n);
      this.hotFeature(feats[0]?.id ?? null);
      this.showSectorHover(n);
      return;
    }
    if (info?.kind === 'feature') {
      this.hotFeature(info.id);
      const b = BEAMLINES[info.id];
      const m = metaById(info.id);
      this.showHovercard(
        h('h4', null, `${b?.sector ?? ''} · ${b?.acronym ?? info.id}`),
        m?.displayName ? h('div', { class: 'row' }, h('b', null, m.displayName)) : null,
        b?.tagline ? h('div', { class: 'row' }, b.tagline) : null,
        h('div', { class: 'hint' }, 'Click to step inside'),
      );
      return;
    }
    if (info?.kind === 'building') {
      const b = SITE.buildings.find((x) => x.id === info.id);
      if (b) {
        this.site.highlightSector(null);
        this.showHovercard(h('h4', null, b.fullName ?? b.name), h('div', { class: 'row' }, BUILDING_NOTES[b.role] ?? ''));
        return;
      }
    }
    if (info?.kind === 'component' && this.bl) {
      const p = this.bl.placed.find((q) => q.data.id === info.id);
      if (p) {
        this.showHovercard(
          h('h4', null, `${p.index}. ${p.data.name}`),
          h('div', { class: 'row' }, componentKind({ category: String(p.data.category), name: p.data.name }), ' · ', h('b', null, formatDist(p.data.distanceM)), ' from source'),
          h('div', { class: 'hint' }, v.mode === 'beamline' ? 'Click for details' : `Click to step inside ${this.bl.data.acronym}`),
        );
        return;
      }
    }
    // the sector whose card is open stays highlighted
    this.site.highlightSector(v.mode === 'overview' && v.focus ? Number(v.focus) : null);
    if (v.mode === 'overview') this.hotFeature(null);
    this.hovercard.classList.remove('is-on');
  }

  private onPick(info: Pickable | null): void {
    const v = store.state.view;
    if (!info) {
      if (v.mode === 'overview' && v.focus) store.go({ mode: 'overview' }, true);
      return;
    }
    if (info.kind === 'feature') store.go({ mode: 'beamline', id: info.id });
    else if (info.kind === 'sector' && v.mode === 'overview') {
      const n = Number(info.id);
      const feats = FEATURE_META.filter((m) => m.sectorNumber === n);
      if (feats.length === 1) store.go({ mode: 'beamline', id: feats[0].id });
      // switching between sector cards replaces the history entry; the first card is a step of its own
      else store.go({ mode: 'overview', focus: String(n) }, !!v.focus);
    } else if (info.kind === 'component' && this.bl) {
      if (v.mode === 'beamline') this.selectComponent(info.id);
      else store.go({ mode: 'beamline', id: this.bl.data.id, component: info.id });
    }
  }

  private showSectorHover(n: number): void {
    const info = SECTOR_INFO[n];
    const feats = FEATURE_META.filter((m) => m.sectorNumber === n);
    const machine = MACHINE_SECTORS[n];
    const rows = (info?.beamlines ?? []).slice(0, 5).map((b) =>
      h(
        'div',
        { class: 'row' },
        h('b', null, b.name),
        ' ',
        beamlineBlurb(b),
        b.feature ? h('span', { class: 'tag tag-feature' }, 'APS-U feature') : b.enhanced ? h('span', { class: 'tag tag-enh' }, 'APS-U enhanced') : null,
      ),
    );
    this.showHovercard(
      h('h4', null, `Sector ${n}`, info?.lom ? h('span', { class: 'muted' }, ` · LOM ${info.lom}`) : null),
      ...rows,
      !rows.length && machine ? h('div', { class: 'row' }, machine.short) : null,
      h('div', { class: 'hint' }, feats.length ? 'Click to step inside' : 'Click for details'),
    );
  }

  /**
   * Fill the sector card for sector n, layered like a label: what the sector's science is, who runs it (fine print),
   * the feature beamlines, what the upgrade changed (each enhancement program once, however many beamlines it covers),
   * then each beamline: what it does, with its techniques in fine print.
   */
  private renderSectorCard(n: number): void {
    const info = SECTOR_INFO[n];
    const feats = FEATURE_META.filter((m) => m.sectorNumber === n);
    const machine = MACHINE_SECTORS[n];
    const beamlines = info?.beamlines ?? [];
    const programs = new Map<string, string[]>();
    for (const b of beamlines) {
      const text = b.enhanced ? b.enhancement?.text?.trim() : undefined;
      if (text) programs.set(text, [...(programs.get(text) ?? []), b.name]);
    }
    this.sectorCard.setAttribute('aria-label', `Sector ${n}`);
    this.sectorCard.replaceChildren(
      ...nodes(
        h('button', { class: 'btn btn-ghost btn-icon sc-close', 'aria-label': 'Close', title: 'Close (Esc)', onclick: () => store.go({ mode: 'overview' }, true) }, icon('close', 15)),
        h(
          'div',
          { class: 'kicker', role: 'heading', 'aria-level': '2', tabindex: '-1' },
          `Sector ${n}`,
          info?.lom ? ` · LOM ${info.lom}` : '',
          info?.canted ? ' · canted undulators' : '',
          machine ? ' · accelerator straight' : '',
        ),
        info?.plainLabel || machine ? h('p', { class: 'sc-lede' }, info?.plainLabel || machine!.short) : null,
        info?.operators ? h('p', { class: 'fineprint sc-ops' }, 'Operated by ', operatorsText(info.operators)) : null,
        ...feats.map((m) =>
          h(
            'button',
            { class: 'feature-card', style: `--c:${m.color}`, onclick: () => store.go({ mode: 'beamline', id: m.id }) },
            h('span', { class: 'fc-dot', 'aria-hidden': 'true' }),
            featureCardText(m, stationTag(m)),
            icon('next', 15),
          ),
        ),
        ...[...programs].map(([text, names]) =>
          h(
            'section',
            { class: 'sc-enh' },
            h('h4', null, h('span', { class: 'tag tag-enh' }, 'APS-U enhancement'), h('span', { class: 'fineprint' }, names.join(' · '))),
            h('p', { class: 'small' }, stripRefs(text)),
          ),
        ),
        ...beamlines
          .filter((b) => !b.feature)
          .map((b) =>
            h(
              'section',
              { class: 'sc-bl' },
              h(
                'h4',
                null,
                beamlineHeading(b),
                b.status ? h('span', { class: 'tag', title: 'Status on the APS commissioning chart, Oct 2026' }, b.status.replace('Scientific Commissioning and Early Experiments', 'early experiments').replace('Restart of General User Program', 'user program')) : null,
                b.enhanced && b.enhancement ? h('span', { class: 'tag tag-enh' }, 'enhanced') : null,
              ),
              b.summary ? h('p', { class: 'small' }, b.summary) : null,
              b.techniques?.length ? h('p', { class: 'fineprint' }, 'Techniques: ', b.techniques.join(' · ')) : null,
              // the sector line above already names who runs it; a beamline's own operator only where there is none
              b.operator && !info?.operators ? h('p', { class: 'fineprint' }, b.operator) : null,
              b.url ? h('a', { class: 'small', href: b.url, target: '_blank', rel: 'noopener' }, 'APS beamline page ↗') : null,
            ),
          ),
        !beamlines.length ? h('p', { class: 'small' }, machine ? machine.text : 'No beamline information available.') : null,
      ),
    );
  }

  private openSectorCard(n: number, takeFocus: boolean): void {
    this.renderSectorCard(n);
    this.sectorCard.classList.add('is-open');
    this.sectorCard.inert = false;
    if (takeFocus) this.sectorCard.querySelector<HTMLElement>('.kicker')?.focus({ preventScroll: true });
  }

  private closeSectorCard(): void {
    if (!this.sectorCard.classList.contains('is-open')) return;
    const hadFocus = this.sectorCard.contains(document.activeElement);
    this.sectorCard.classList.remove('is-open');
    this.sectorCard.inert = true;
    if (hadFocus) this.stage.renderer.domElement.focus({ preventScroll: true });
  }

  /** Frame the sector's experiment-hall stretch (its hutches) in the area the sector card leaves free. */
  private flyToSector(n: number): void {
    const f = sectorFrame(n);
    const g = -SITE.beamHeightM;
    const pts: THREE.Vector3[] = [];
    for (const d of [22, 78]) for (const side of [-14, 14]) pts.push(alongBeam(f, d, side, g), alongBeam(f, d, side, g + 5));
    const dir = f.dir.clone().multiplyScalar(-0.5).addScaledVector(f.right, 0.7).add(new THREE.Vector3(0, 0.76, 0));
    const { pos, target } = this.stage.framePoints(pts, dir, { pad: 40 });
    void this.stage.flyTo(pos, target);
  }

  // ---------------------------------------------------------------- views

  private queueInsets(): void {
    if (this.insetsQueued) return;
    this.insetsQueued = true;
    requestAnimationFrame(() => {
      this.insetsQueued = false;
      this.updateInsets();
    });
  }

  /** Pixels of the canvas covered by UI chrome in the current view (camera framing and pins keep clear of them). */
  private updateInsets(): void {
    const v = store.state.view;
    const H = window.innerHeight;
    const narrow = window.innerWidth <= 900;
    // bottom cards sit 18 px above the edge; keep another 12 px clear above them
    const card = this.sectorCard.classList.contains('is-open') ? this.sectorCard.offsetHeight + 30 : 0;
    const tour = v.mode === 'tour' ? this.tour.el.offsetHeight + 30 : 0;
    if (narrow) {
      // bottom sheets: the beamline panel, the overview guide (or, collapsed, the strip of it that still peeks out)
      let sheet = 0;
      if (v.mode === 'beamline') sheet = H * 0.54;
      else if (v.mode === 'overview') {
        const ov = this.overview.el;
        const btn = ov.querySelector<HTMLElement>('.ov-collapse');
        if (!ov.classList.contains('is-away')) sheet = ov.classList.contains('is-collapsed') ? (btn ? btn.offsetTop + btn.offsetHeight + 24 : 72) : H * 0.46;
      }
      this.stage.setInsets({ bottom: Math.max(sheet, card, tour, v.mode === 'tour' ? 160 : 0), top: 56 });
      return;
    }
    if (v.mode === 'overview') {
      const collapsed = this.overview.el.classList.contains('is-collapsed');
      this.stage.setInsets({ left: collapsed ? 40 : this.overview.el.offsetWidth + 14, top: 60, bottom: card });
    } else if (v.mode === 'beamline') {
      this.stage.setInsets({ right: this.panel.el.offsetWidth + 14, bottom: this.strip.el.offsetHeight + 22, top: 60 });
    } else {
      this.stage.setInsets({ bottom: tour, top: 60 });
    }
  }

  /** Apply the store's view once it can be shown (beamline views wait for the layouts; the overview does not). */
  private scheduleView(): void {
    const v = store.state.view;
    const wait = this.layoutsReady || v.mode === 'overview' ? Promise.resolve() : this.ready;
    void wait.then(() => this.applyLatest());
  }

  private applyLatest(): void {
    const v = store.state.view;
    if (v === this.applied) return;
    const fix = this.normalizeView(v);
    if (fix) {
      store.go(fix, true);
      return;
    }
    // keep the address bar canonical (e.g. #/tour/abc → #/tour/0)
    const hash = viewToHash(v);
    if (location.hash !== hash && !(hash === '#/' && (location.hash === '' || location.hash === '#'))) history.replaceState(null, '', hash);
    const prev = this.applied;
    this.applied = v;
    try {
      this.applyView(v, prev);
    } catch (e) {
      this.recover(v, e);
    }
  }

  /** A corrected view for deep links that name no real place (unknown beamline, sector 0 or 77, tour stop 99). */
  private normalizeView(v: View): View | null {
    switch (v.mode) {
      case 'overview': {
        if (v.focus === undefined) return null;
        const n = /^\d{1,3}$/.test(v.focus) ? Number(v.focus) : NaN;
        if (!(n >= 1 && n <= SITE.sectors)) return { mode: 'overview' };
        return String(n) === v.focus ? null : { mode: 'overview', focus: String(n) };
      }
      case 'tour': {
        const s = Number.isInteger(v.step) ? clamp(v.step, 0, TOUR.length - 1) : 0;
        return s === v.step ? null : { mode: 'tour', step: s };
      }
      case 'beamline':
        return BEAMLINES[v.id] && metaById(v.id) ? null : { mode: 'overview' };
    }
  }

  /** A view failed to show: log it and fall back to the overview, so one broken beamline never blocks navigation. */
  private recover(v: View, e: unknown): void {
    console.error(`could not show ${viewToHash(v)}`, e);
    if (v.mode === 'overview') return;
    try {
      this.leaveBeamline();
    } catch (e2) {
      console.error('leaving the beamline failed too', e2);
      this.bl = null;
      this.stage.removePickables((i) => i.kind === 'component');
    }
    store.go({ mode: 'overview' }, true);
  }

  private applyView(v: View, prev: View | null): void {
    if (sameView(prev, v)) return; // e.g. a redundant store.go from a tab click: keep the visitor's camera
    if (v.mode === 'beamline' && prev?.mode === 'tour') this.tourReturnStep = prev.step;
    else if (v.mode !== 'beamline') this.tourReturnStep = null;
    this.stopRide();
    this.hovercard.classList.remove('is-on');
    this.stage.refreshHover();
    this.stage.invalidateLabels();
    if (v.mode !== 'tour') {
      this.tour.hide();
      this.site.setTourMode({});
    }
    if (v.mode !== 'overview') this.site.highlightSector(null);
    const owner = this.stationOwner;
    if (owner && this.modal.isOpen) {
      const stays = owner.mode === 'tour'
        ? v.mode === 'tour' && v.step === owner.step
        : v.mode === 'beamline' && v.id === owner.id;
      if (!stays) this.modal.close();
    }

    if (v.mode === 'overview') this.showOverview(v, prev);
    else if (v.mode === 'beamline') this.showBeamline(v, prev);
    else this.showTour(v);
    this.stage.requestShadowUpdate();
    this.queueInsets();
  }

  private showOverview(v: Extract<View, { mode: 'overview' }>, prev: View | null): void {
    this.leaveBeamline();
    const n = v.focus ? Number(v.focus) : null;
    // A sector card occupies the phone's bottom sheet; keep the guide out of its view and tab order until it closes.
    this.overview.setVisible(!n || window.innerWidth > 900);
    this.topbar.setCrumbs(n ? [{ label: 'The APS', onClick: () => this.goHome() }, { label: `Sector ${n}` }] : [{ label: 'The APS' }]);
    this.stage.setLabel(n ? `3D model of the Advanced Photon Source, sector ${n}` : '3D model of the Advanced Photon Source');
    if (n) this.openSectorCard(n, prev !== null);
    else this.closeSectorCard();
    this.site.highlightSector(n);
    this.updateInsets();
    if (n) this.flyToSector(n);
    else if (prev === null && !IS_TEST) {
      this.stage.jumpTo(new THREE.Vector3(-900, 1500, 1900), new THREE.Vector3());
      void this.stage.flyTo(...this.overviewPose(), { duration: 4.2, arc: 0 });
    } else if (prev?.mode !== 'overview') this.overviewCamera(prev === null);
    // closing a sector card leaves the camera where the visitor has it
  }

  private showBeamline(v: Extract<View, { mode: 'beamline' }>, prev: View | null): void {
    const data = BEAMLINES[v.id];
    const layout = this.layoutOf(v.id);
    if (v.component && !placedIds(data, layout).includes(v.component)) {
      store.go({ mode: 'beamline', id: v.id }, true);
      return;
    }
    this.dismissIntro();
    this.closeSectorCard();
    const entering = this.bl?.data.id !== v.id;
    this.beamlineUi(v, layout);
    if (entering) this.buildSoon(v.id, prev === null);
    else this.showInScene(v, prev?.mode !== 'beamline', false);
  }

  /** Panel, path strip, crumbs and canvas label of a beamline view (they need the dossier and layout, not the scene). */
  private beamlineUi(v: Extract<View, { mode: 'beamline' }>, layout: BeamlineLayout): void {
    const data = BEAMLINES[v.id];
    const meta = metaById(v.id)!;
    this.overview.setVisible(false);
    this.panel.hiddenIds = new Set(Object.entries(layout.comp ?? {}).filter(([, o]) => o.hidden).map(([k]) => k));
    this.panel.setTourReturn(this.tourReturnStep);
    this.panel.show(data, meta, v.component ?? null);
    this.strip.show(data, meta.color, (cid) => this.branchOf(data, layout, cid), this.branchLabels(data, layout), layout);
    this.strip.setActive(v.component ?? null);
    const crumbs = [
      { label: 'The APS', onClick: () => store.go({ mode: 'overview' }) },
      { label: `Sector ${meta.sectorNumber}`, onClick: () => store.go({ mode: 'overview', focus: String(meta.sectorNumber) }) },
      { label: data.acronym, onClick: v.component ? () => store.go({ mode: 'beamline', id: v.id }, true) : undefined },
    ];
    const comp = v.component ? data.components.find((c) => c.id === v.component)?.name : undefined;
    if (v.component) crumbs.push({ label: comp ?? v.component, onClick: undefined });
    this.topbar.setCrumbs(crumbs);
    this.stage.setLabel(`3D model of ${data.acronym}, ${stationTag(meta)}${comp ? `: ${comp}` : ''}`);
    this.updateInsets();
  }

  /** The 3D side of a view whose beamline scene exists: pins, selection and camera. */
  private showInScene(v: View, long: boolean, instant: boolean): void {
    const bl = this.bl;
    if (!bl) return;
    if (v.mode === 'tour') {
      bl.setPinMode('tour');
      bl.setActive(null);
      this.frameBeamline(instant);
      return;
    }
    if (v.mode !== 'beamline') return;
    bl.setPinMode('normal');
    bl.setActive(v.component ?? null);
    // a long flight whenever the camera is not already inside this beamline
    if (v.component) this.focusComponent(v.component, long);
    else this.frameBeamline(instant);
  }

  /** Layout of a beamline: the open scene's own (it may have fallen back to the default), else the loaded one. */
  private layoutOf(id: string): BeamlineLayout {
    return this.bl?.data.id === id ? this.bl.layout : layoutFor(id);
  }

  /**
   * Start construction after the panel has painted. The scene builds in small tasks while the camera moves.
   * Component selection or navigation can change while construction is in progress.
   */
  private buildSoon(id: string, instant: boolean): void {
    const request = ++this.buildRequest;
    this.pendingBuild = id;
    requestAnimationFrame(() =>
      setTimeout(() => {
        if (request !== this.buildRequest || this.pendingBuild !== id) return;
        this.pendingBuild = null;
        const v = this.applied;
        const wanted = this.wantedBeamline();
        if (!v || wanted !== id) return;
        try {
          const uiLayout = layoutFor(id);
          if (!this.enterBeamline(id)) {
            console.error(`beamline ${id} could not be shown`);
            store.go({ mode: 'overview' }, true);
            return;
          }
          // the scene fell back to the default layout: the strip and panel follow it
          if (v.mode === 'beamline' && this.bl!.layout !== uiLayout) {
            if (v.component && !placedIds(BEAMLINES[id], this.bl!.layout).includes(v.component)) {
              store.go({ mode: 'beamline', id }, true);
              return;
            }
            this.beamlineUi(v, this.bl!.layout);
          }
          this.showInScene(v, true, instant);
          this.stage.requestShadowUpdate();
          this.stage.invalidateLabels();
        } catch (e) {
          this.recover(v, e);
        }
      }, 0),
    );
  }

  private showTour(v: Extract<View, { mode: 'tour' }>): void {
    const step = TOUR[v.step];
    this.dismissIntro();
    this.closeSectorCard();
    this.panel.hide();
    this.strip.hide();
    this.overview.setVisible(false);
    this.topbar.setCrumbs([{ label: 'The APS', onClick: () => store.go({ mode: 'overview' }) }, { label: `Guided tour · ${v.step + 1}/${TOUR.length}` }]);
    this.stage.setLabel(`3D model, guided tour stop ${v.step + 1} of ${TOUR.length}: ${step.title}`);
    this.tour.show(v.step);
    this.updateInsets();
    this.applyTourShot(step.shot);
  }

  /** Build and open a beamline scene. Returns false when it could not be built at all. */
  private enterBeamline(id: string): boolean {
    this.cancelBuild();
    const outgoing = this.bl?.group.visible ? this.bl : this.previousBeamline;
    const data = BEAMLINES[id];
    const meta = metaById(id);
    if (!data || !meta) return false;
    const cached = this.sceneCache.get(id);
    const bl = cached ?? this.buildBeamline(data, meta);
    if (!bl) return false;
    this.bl = bl;
    this.previousBeamline = outgoing === bl ? null : outgoing;
    // nano-optics are millimetres in size: allow the camera right up to them inside a beamline
    this.stage.controls.minDistance = 0.12;
    bl.setPinMode(store.state.view.mode === 'tour' ? 'tour' : 'normal');
    if (cached) this.revealBeamline(bl);
    else this.prepareBeamline(bl);
    return true;
  }

  private prepareBeamline(bl: BeamlineScene, fallback = false): void {
    const abort = new AbortController();
    this.buildAbort = abort;
    this.pendingBuild = bl.data.id;
    void bl.buildAsync(abort.signal)
      .then(() => {
        abort.signal.throwIfAborted();
        return bl.prepare();
      })
      .then(() => {
        if (abort.signal.aborted || this.bl !== bl || this.wantedBeamline() !== bl.data.id) return;
        this.buildAbort = null;
        this.pendingBuild = null;
        this.revealBeamline(bl);
        const followPath = this.rideRequested;
        const v = this.applied;
        if (v?.mode === 'beamline') {
          if (bl.layout !== layoutFor(bl.data.id)) {
            if (v.component && !placedIds(bl.data, bl.layout).includes(v.component)) {
              store.go({ mode: 'beamline', id: bl.data.id }, true);
              return;
            }
            this.beamlineUi(v, bl.layout);
          }
          if (v.component || fallback) this.showInScene(v, true, false);
        } else if (fallback && v) this.showInScene(v, true, false);
        if (followPath && v?.mode === 'beamline') this.rideBeam();
      })
      .catch((e) => {
        if (abort.signal.aborted || this.bl !== bl || this.wantedBeamline() !== bl.data.id) return;
        this.buildAbort = null;
        bl.dispose(this.retainedScenes());
        if (!fallback) {
          console.error(`beamline ${bl.data.id}: the scene could not be built; retrying with the default layout`, e);
          const replacement = this.buildBeamline(bl.data, bl.meta, true);
          if (replacement) {
            this.bl = replacement;
            replacement.setPinMode(store.state.view.mode === 'tour' ? 'tour' : 'normal');
            this.prepareBeamline(replacement, true);
            return;
          }
        }
        if (this.applied) this.recover(this.applied, e);
      });
  }

  /**
   * The detailed scene for a beamline. A layout that throws while building degrades to the default layout (and, if
   * even that fails, to nothing); whatever the failed attempt registered is removed again.
   */
  private buildBeamline(data: Beamline, meta: BeamlineMeta, fallback = false): BeamlineScene | null {
    const id = data.id;
    const attempts = fallback ? [DEFAULT_LAYOUT(id)] : [layoutFor(id), DEFAULT_LAYOUT(id)];
    for (let i = 0; i < attempts.length; i++) {
      try {
        return new BeamlineScene(this.stage, data, meta, attempts[i], (cid) => this.onPinClick(id, cid), true);
      } catch (e) {
        console.error(`beamline ${id}: the scene could not be built${i ? ' even with the default layout' : '; retrying with the default layout'}`, e);
        this.stage.scene.getObjectByName(`beamline-${id}`)?.removeFromParent();
      }
    }
    return null;
  }

  private revealBeamline(bl: BeamlineScene): void {
    if (this.bl !== bl) return;
    const previous = this.previousBeamline;
    this.previousBeamline = null;
    if (previous && previous !== bl) {
      previous.hide();
      this.site.hideGenericHutches(previous.meta.sectorNumber, false);
    }
    bl.show();
    const c = bl.toWorld(bl.at(bl.length / 2));
    this.stage.fitShadow(c, Math.max(40, bl.length * 0.65));
    bl.onBatched = () => this.stage.requestShadowUpdate();
    this.stage.setShadowRate(bl.animated ? BEAMLINE_SHADOW_HZ : 0);
    this.site.setFocus(bl.data.id, bl.meta.sectorNumber);
    this.site.hideGenericHutches(bl.meta.sectorNumber, true);
    this.sceneCache.delete(bl.data.id);
    this.sceneCache.set(bl.data.id, bl);
    while (this.sceneCache.size > 2) {
      const oldest = this.sceneCache.keys().next().value!;
      const evicted = this.sceneCache.get(oldest)!;
      this.sceneCache.delete(oldest);
      evicted.dispose(this.retainedScenes());
    }
    this.stage.requestShadowUpdate();
    this.stage.invalidateLabels();
    this.stage.refreshHover();
    this.updateHud();
  }

  /** Return to the site view, keeping recent models hidden for later visits. */
  private leaveBeamline(): void {
    this.stopRide();
    this.cancelBuild();
    this.stage.controls.minDistance = 1.2;
    for (const bl of new Set([this.bl, this.previousBeamline])) {
      if (!bl) continue;
      this.site.hideGenericHutches(bl.meta.sectorNumber, false);
      bl.hide();
    }
    this.bl = null;
    this.previousBeamline = null;
    this.stage.fitShadow(new THREE.Vector3(), 330);
    this.stage.setShadowRate(0);
    this.site.setFocus(null, null);
    this.panel.hide();
    this.strip.hide();
  }

  private retainedScenes(): Set<BeamlineScene> {
    const scenes = new Set(this.sceneCache.values());
    if (this.bl) scenes.add(this.bl);
    if (this.previousBeamline) scenes.add(this.previousBeamline);
    return scenes;
  }

  private cancelBuild(): void {
    ++this.buildRequest;
    this.pendingBuild = null;
    if (!this.buildAbort) return;
    this.buildAbort.abort();
    this.buildAbort = null;
    if (this.bl && this.sceneCache.get(this.bl.data.id) !== this.bl) {
      this.bl.dispose(this.retainedScenes());
      this.bl = null;
    }
  }

  private wantedBeamline(): string | null {
    const v = this.applied;
    if (v?.mode === 'beamline') return v.id;
    const shot = v?.mode === 'tour' ? TOUR[v.step]?.shot : null;
    return shot?.kind === 'beamline' ? shot.id : null;
  }

  private branchOf(data: Beamline, layout: BeamlineLayout, cid: string): string | null {
    const c = data.components.find((q) => q.id === cid);
    return c ? compBranch(c, layout) : null;
  }

  private branchLabels(data: Beamline, layout: BeamlineLayout): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(layout.branches ?? {})) out[k] = v.label ?? k;
    for (const b of data.branches ?? []) out[b.id] ??= b.name;
    return out;
  }

  private frameBeamline(instant = false): void {
    if (!this.bl) return;
    this.stopRide();
    const bl = this.bl;
    const el = this.stage.renderer.domElement;
    const w = el.clientWidth || 1;
    const ins = this.stage.getInsets();
    const visible = clamp((w - ins.left - ins.right) / w, 0.35, 1);
    let { pos, target } = bl.overviewShot(w / (el.clientHeight || 1), visible, this.stage.camera.fov);
    if (store.state.view.mode === 'tour') {
      // the layout's shot fits the beamline's length across the screen; above a tall tour card it may also need to
      // back off (same direction and look-at point) until the hutches fit vertically
      const fit = this.stage.framePoints(this.beamlineEnvelope(bl), pos.clone().sub(target), { pad: 24, target });
      if (fit.pos.distanceTo(target) > pos.distanceTo(target)) pos = fit.pos;
    }
    if (instant) {
      this.stage.jumpTo(pos, target);
      requestAnimationFrame(() => this.updateHud());
    } else void this.stage.flyTo(pos, target).then(() => this.updateHud());
  }

  /** Points outlining a beamline's footprint (each branch, floor to hutch-roof height), in world space. */
  private beamlineEnvelope(bl: BeamlineScene): THREE.Vector3[] {
    const partners = new Set(bl.layout.partnerBranches ?? []);
    const branches: (string | null)[] = [null, ...Object.keys(bl.layout.branches ?? {}).filter((b) => !partners.has(b))];
    const floor = -bl.beamY;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const x = (bl.length * i) / 6;
      for (const b of branches) {
        const s = bl.sideAt(b, x);
        pts.push(bl.toWorld(bl.at(x, s - 3, floor)), bl.toWorld(bl.at(x, s + 3, floor)), bl.toWorld(bl.at(x, s, floor + 3.5)));
      }
    }
    return pts;
  }

  private focusComponent(id: string, long: boolean): void {
    const shot = this.bl?.componentShot(id);
    if (!shot) return;
    this.stopRide();
    void this.stage.flyTo(shot.pos, shot.target, long ? {} : { duration: 1.3, arc: 2 }).then(() => this.updateHud());
  }

  private stopRide(): void {
    this.rideRequested = false;
    this.ride?.cancel();
    this.ride = null;
  }

  /**
   * Move the camera along the X-ray path from the source to the last component. Anything else that moves the camera (another
   * view, framing, a drag) ends it, also during the short fly-in. Under reduced motion it jumps from stop to stop.
   */
  private rideBeam(): void {
    const bl = this.bl;
    if (!bl) return;
    if (this.pendingBuild) {
      this.rideRequested = true;
      return;
    }
    this.stopRide();
    this.stage.cancelFlight();
    const ride = {
      cancelled: false,
      run: null as { cancel: () => void } | null,
      cancel(): void {
        this.cancelled = true;
        this.run?.cancel();
      },
    };
    this.ride = ride;
    const L = Math.max(...bl.placed.map((p) => p.local.x), 20);
    const pos = new THREE.Vector3();
    const tgt = new THREE.Vector3();
    const camAt = (x: number): void => {
      const side = bl.sideAt(bl.placed.find((p) => p.local.x >= x)?.branch ?? null, x);
      pos.copy(bl.toWorld(bl.at(x, side + 3.2, 1.6)));
      tgt.copy(bl.toWorld(bl.at(x + 9, side, 0)));
    };
    const reduced = prefersReducedMotion();
    void this.stage.flyTo(bl.toWorld(bl.at(-8, 3.5, 2.2)), bl.toWorld(bl.at(2)), { duration: 1.6, arc: 4 }).then((arrived) => {
      if (!arrived || ride.cancelled || this.ride !== ride || this.bl !== bl) return;
      let run: { done: Promise<boolean>; cancel: () => void };
      if (reduced) {
        // a still view of each stretch of the beamline in turn, no motion in between
        const gap = Math.max(3, L / 12);
        const stops: number[] = [];
        for (const x of bl.placed.map((p) => p.local.x).sort((a, b) => a - b)) if (!stops.length || x - stops[stops.length - 1] >= gap) stops.push(x);
        let shown = -1;
        run = this.stage.tweens.run(
          stops.length * 2.5,
          (k) => {
            const i = Math.min(stops.length - 1, Math.floor(k * stops.length));
            if (i === shown) return;
            shown = i;
            camAt(stops[i] - 6);
            this.stage.jumpTo(pos, tgt);
          },
          ease.linear,
        );
      } else {
        run = this.stage.tweens.run(
          Math.min(26, 6 + L * 0.18),
          (k) => {
            camAt(-8 + k * (L + 8));
            this.stage.jumpTo(pos, tgt);
          },
          ease.inOutSine,
        );
      }
      ride.run = run;
      void run.done.then(() => {
        if (this.ride === ride) this.ride = null;
      });
    });
  }

  /** Centroid of a building footprint (vertex average, as the site labels use), at height h. */
  private buildingAnchor(role: string, h: number): { at: THREE.Vector3; heightM: number; polygon: [number, number][] } | null {
    const b = SITE.buildings.find((x) => x.role === role);
    if (!b) return null;
    const n = b.polygon.length;
    const [cx, cy] = b.polygon.reduce((acc, [x, y]) => [acc[0] + x / n, acc[1] + y / n], [0, 0]);
    return { at: toWorld(cx, cy, b.heightM + h), heightM: b.heightM, polygon: b.polygon };
  }

  /**
   * Overview framing: the whole experiment hall plus the Long Beamline Building beyond it, with room for the
   * building's label, all clear of the overview panel.
   */
  private overviewPose(): [THREE.Vector3, THREE.Vector3] {
    const pts = ringPoints(SITE.hallOuterM, 24);
    const lbb = this.buildingAnchor('long-beamline-building', 2);
    for (const [x, y] of lbb?.polygon ?? []) pts.push(toWorld(x, y, 0), toWorld(x, y, lbb!.heightM));
    const labels = lbb ? [{ at: lbb.at, w: 210, h: 22 }] : [];
    const { pos, target } = this.stage.framePoints(pts, new THREE.Vector3(0.65, 1.85, 2.08), { pad: 28, labels });
    return [pos, target];
  }

  private overviewCamera(instant = false): void {
    this.stopRide();
    const [pos, target] = this.overviewPose();
    if (instant) this.stage.jumpTo(pos, target);
    else void this.stage.flyTo(pos, target);
  }

  private applyTourShot(shot: TourShot): void {
    this.site.setTourMode({});
    if (shot.kind === 'overview') {
      this.leaveBeamline();
      this.overviewCamera();
      return;
    }
    if (shot.kind === 'beamline') {
      const v = this.applied;
      if (this.bl?.data.id === shot.id) {
        if (v) this.showInScene(v, false, false);
      } else {
        this.buildSoon(shot.id, false);
      }
      return;
    }
    this.leaveBeamline();
    this.site.setTourMode({
      injectorXray: shot.target === 'injector',
      undulatorSector: shot.target === 'undulator' ? 3 : null,
      pins: shot.target === 'longBeamlines',
      walls: shot.target === 'undulator' || shot.target === 'ring',
    });
    switch (shot.target) {
      case 'injector': {
        // linac, particle accumulator ring and booster together, with room for their labels (Site places them just
        // beyond each structure, on whichever side fits)
        const inj = SITE.injector;
        const [bx, by] = inj.booster.center;
        const [px, py] = inj.par.center;
        const pts = [...inj.linac.map(([x, y]) => toWorld(x, y)), ...ringPoints(inj.par.radiusM, 8, inj.par.center), ...ringPoints(inj.booster.radiusM, 16, inj.booster.center)];
        const lin = inj.linac;
        const labels = [
          { at: toWorld(bx, by - inj.booster.radiusM - 8, 4), w: 200, h: 22 },
          { at: toWorld(px, py + inj.par.radiusM + 5, 3), w: 210, h: 22 },
          ...(lin.length >= 2 ? [{ at: toWorld((lin[0][0] + lin[lin.length - 1][0]) / 2, (lin[0][1] + lin[lin.length - 1][1]) / 2 + 10, 4), w: 70, h: 22 }] : []),
        ];
        const { pos, target } = this.stage.framePoints(pts, new THREE.Vector3(70, 120, 150), { pad: 32, labels });
        void this.stage.flyTo(pos, target);
        break;
      }
      case 'ring': {
        const f = sectorFrame(2);
        const t = alongBeam(f, 12, -2.5, -0.6);
        void this.stage.flyTo(alongBeam(f, -6, -9, 7), t);
        break;
      }
      case 'undulator': {
        const f = sectorFrame(3);
        void this.stage.flyTo(alongBeam(f, -2.2, -3.6, 1.5), alongBeam(f, 0.4, 0, -0.2));
        break;
      }
      case 'longBeamlines': {
        // ISN (19-ID, end station at ~213–227 m) and HEXM (20-ID, ~178–197 m): the ring edge where they start, the
        // corridors and the Long Beamline Building, seen from above their outboard side
        const a = sectorFrame(19);
        const b = sectorFrame(20);
        const pts = [alongBeam(a, 0), alongBeam(b, 0), alongBeam(a, 228), alongBeam(b, 198)];
        const lbb = this.buildingAnchor('long-beamline-building', 2);
        for (const [x, y] of lbb?.polygon ?? []) pts.push(toWorld(x, y, 0));
        const along = a.dir.clone().add(b.dir).normalize();
        const out = a.right.clone().add(b.right).normalize();
        const dir = out.multiplyScalar(0.62).addScaledVector(along, -0.12).add(new THREE.Vector3(0, 0.95, 0));
        const { pos, target } = this.stage.framePoints(pts, dir, { pad: 56, labels: lbb ? [{ at: lbb.at, w: 210, h: 22 }] : [] });
        void this.stage.flyTo(pos, target);
        break;
      }
    }
  }

  updateHud(): void {
    const v = store.state.view;
    const el = this.stage.renderer.domElement;
    const W = el.clientWidth;
    const H = el.clientHeight;
    const safe = this.stage.getInsets();
    if (this.bl) {
      // tour stops too: there the scene shows only its headline pins (setPinMode('tour')), still decluttered
      this.bl.updatePinDensity(this.stage.camera, W, H, safe);
      if (v.mode === 'beamline') {
        const tgt = this.stage.controls.getTarget(new THREE.Vector3());
        this.strip.setCursor(this.bl.group.worldToLocal(tgt).x);
      }
    }
    const d = this.stage.camera.position.length();
    this.site.setLabelVisibility(d < 260);
    if (v.mode !== 'beamline') this.site.declutterPins(this.stage.camera, W, H, safe);
  }

  // ---------------------------------------------------------------- intro

  private showIntro(): void {
    this.intro = buildIntro(
      () => this.dismissIntro(),
      () => {
        this.dismissIntro();
        store.go({ mode: 'tour', step: 0 });
      },
    );
    this.ui.appendChild(this.intro);
    document.body.classList.add('intro-open');
    requestAnimationFrame(() => this.intro?.classList.add('is-open'));
  }

  private dismissIntro(): void {
    if (!this.intro) return;
    const el = this.intro;
    this.intro = null;
    store.set({ introSeen: true });
    document.body.classList.remove('intro-open');
    el.classList.remove('is-open');
    setTimeout(() => el.remove(), 500);
  }
}

/** n points on a ground circle (site coordinates of the centre, metres). */
function ringPoints(r: number, n: number, center: [number, number] = [0, 0]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push(toWorld(center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)));
  }
  return out;
}
