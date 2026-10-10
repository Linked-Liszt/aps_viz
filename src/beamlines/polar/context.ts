import * as THREE from 'three';
import type { BuildCtx } from '../../scene/beamline/layout';
import { box, cyl, flangeX, opticalTable, pedestal, pipeX, pm, shadowed } from './kit';
import { TABLES, TABLE_TOP } from './geometry';

/**
 * Non-clickable context that makes the hutches read as real rooms: optics tables, the beam pipes between devices,
 * the 4-ID-H loading platform and stairs, the LHe dewar position and the control-room furniture.
 * Positions scaled from the 2021 'Sector 4 2024' plan (±0.3 m).
 */
export function buildContext(ctx: BuildCtx): void {
  const root = new THREE.Group();
  root.name = 'polar-context';
  const B = ctx.beamY;
  const place = (o: THREE.Object3D, x: number, side = 0, up = 0) => {
    o.position.copy(ctx.at(x, side, up));
    root.add(o);
  };

  // optics tables in 4-ID-B, -G, -H
  for (const t of Object.values(TABLES)) place(opticalTable(B, t.x1 - t.x0, t.half * 2, TABLE_TOP), (t.x0 + t.x1) / 2);

  // vacuum pipes bridging the gaps between devices
  const runs: [number, number, number, number[]][] = [
    // [x0, x1, radius, stand positions]
    [24.3, 24.85, 0.03, []],
    [26.22, 26.76, 0.028, []],
    [27.24, 27.6, 0.028, []],
    [29.48, 29.99, 0.028, [29.75]],
    [32.46, 32.86, 0.022, []],
    [34.05, 34.66, 0.03, [34.35]],
    [35.54, 36.12, 0.04, [35.85]],
    [50.45, 52.78, 0.045, [51.2, 52.2]],
    [55.48, 57.62, 0.03, [56.5]],
    [58.88, 59.15, 0.02, []],
    [61.06, 64.16, 0.032, [62.2, 63.9]],
    [64.64, 64.78, 0.02, []],
    [65.62, 66.5, 0.022, [66.05]],
    [67.75, 71.27, 0.032, [68.9, 70.5]],
    [74.46, 75.5, 0.03, [75.0]],
    [76.65, 77.32, 0.03, []],
  ];
  for (const [x0, x1, r, stands] of runs) {
    const g = new THREE.Group();
    g.add(pipeX(0, x1 - x0, r), flangeX(0, r + 0.022), flangeX(x1 - x0, r + 0.022));
    for (const s of stands) {
      const onTable = Object.values(TABLES).some((t) => s > t.x0 && s < t.x1);
      const p = pedestal(onTable ? -TABLE_TOP : B, -r - 0.01, 0.05, 0.05, pm.steel());
      p.position.x = s - x0;
      g.add(p);
    }
    place(shadowed(g), x0);
  }

  // 4-ID-H: loading platform beside the 9-1-1 T magnet (beam passes underneath) and stairs down to the inboard side
  {
    const g = new THREE.Group();
    const deckY = 0.5;
    const x0 = 73.86;
    const x1 = 74.66;
    const zIn = -0.32;
    const zOut = 0.42;
    const deck = box(x1 - x0, 0.05, zOut - zIn, pm.tread(), 0.005);
    deck.position.set((x0 + x1) / 2, deckY, (zIn + zOut) / 2);
    g.add(deck);
    for (const [x, z] of [[x0 + 0.03, zOut - 0.03], [x1 - 0.03, zOut - 0.03], [x0 + 0.03, zIn + 0.03], [x1 - 0.03, zIn + 0.03]] as const) {
      const post = box(0.05, deckY + B, 0.05, pm.railing(), 0.004);
      post.position.set(x, (deckY - B) / 2, z);
      g.add(post);
    }
    // railings: outboard and downstream edges (the upstream edge faces the magnet top)
    const rail = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az);
      for (const h of [0.5, 1.0]) {
        const r = box(len, 0.035, 0.035, pm.railing(), 0.004);
        r.position.set((ax + bx) / 2, deckY + h, (az + bz) / 2);
        r.rotation.y = -Math.atan2(bz - az, bx - ax);
        g.add(r);
      }
      for (const [px, pz] of [[ax, az], [bx, bz]]) {
        const p = box(0.035, 1.0, 0.035, pm.railing(), 0.004);
        p.position.set(px, deckY + 0.5, pz);
        g.add(p);
      }
    };
    rail(x0, zOut, x1, zOut);
    rail(x1, zOut, x1, zIn);
    // stairs: treads descending toward inboard
    const steps = 10;
    const rise = (deckY + B) / (steps + 1);
    const run = 0.12;
    for (let i = 0; i < steps; i++) {
      const y = deckY - (i + 1) * rise;
      const z = zIn - (i + 0.5) * run;
      const tr = box(x1 - x0 - 0.1, 0.035, run * 1.05, pm.tread(), 0.003);
      tr.position.set((x0 + x1) / 2, y, z);
      g.add(tr);
    }
    const zEnd = zIn - steps * run;
    for (const x of [x0 + 0.03, x1 - 0.03]) {
      const len = Math.hypot(zIn - zEnd, deckY + B);
      const str = box(0.04, 0.16, len, pm.railing(), 0.004);
      str.position.set(x, (deckY - B) / 2, (zIn + zEnd) / 2);
      str.rotation.x = -Math.atan2(deckY + B, zIn - zEnd);
      const hr = box(0.03, 0.03, len, pm.railing(), 0.004);
      hr.position.set(x, (deckY - B) / 2 + 0.9, (zIn + zEnd) / 2);
      hr.rotation.x = str.rotation.x;
      g.add(str, hr);
    }
    place(shadowed(g), 0);
  }

  // 4-ID-H: low platform beside the 4 T magnet (inboard)
  {
    const g = new THREE.Group();
    const deckY = -B + 0.6;
    const deck = box(1.0, 0.05, 0.6, pm.tread(), 0.005);
    deck.position.set(76.7, deckY, -1.04);
    g.add(deck);
    const skirt = box(1.0, 0.55, 0.58, pm.railing(), 0.005);
    skirt.position.set(76.7, -B + 0.29, -1.04);
    g.add(skirt);
    for (let i = 0; i < 3; i++) {
      const s = box(0.1, (i + 1) * 0.15, 0.6, pm.tread(), 0.004);
      s.position.set(76.15 - (2 - i) * 0.1 + 0.0, -B + ((i + 1) * 0.15) / 2, -1.04);
      g.add(s);
    }
    for (const x of [76.22, 77.18]) {
      const p = box(0.035, 1.0, 0.035, pm.railing(), 0.004);
      p.position.set(x, deckY + 0.5, -1.32);
      g.add(p);
    }
    const r = box(0.96, 0.035, 0.035, pm.railing(), 0.004);
    r.position.set(76.7, deckY + 1.0, -1.32);
    g.add(r);
    place(shadowed(g), 0);
  }

  // 4-ID-H: liquid-helium transport dewar at its marked position (upstream-inboard of the magnet)
  {
    const g = new THREE.Group();
    const dew = cyl(0.3, 1.3, new THREE.MeshStandardMaterial({ color: 0xd3d9df, roughness: 0.3, metalness: 0.8 }), 40);
    dew.position.y = -B + 0.12 + 0.65;
    const neck = cyl(0.06, 0.18, pm.steel(), 16);
    neck.position.y = -B + 0.12 + 1.3 + 0.09;
    const ringT = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.02, 8, 32), pm.steel());
    ringT.rotation.x = Math.PI / 2;
    ringT.position.y = -B + 1.45;
    const dolly = box(0.66, 0.08, 0.66, pm.darkSteel(), 0.01);
    dolly.position.y = -B + 0.08;
    g.add(dew, neck, ringT, dolly);
    place(shadowed(g), 72.25, -1.17);
  }

  // control room (outboard of 4-ID-B): racks at the upstream end, two operator desks with monitors
  {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const rack = box(0.6, 2.0, 0.8, pm.black(), 0.01);
      rack.position.set(53.3 + i * 0.62, -B + 1.0, 2.05);
      const led = box(0.02, 0.6, 0.004, pm.screen(), 0);
      led.position.set(53.1 + i * 0.62, -B + 1.2, 1.648);
      g.add(rack, led);
    }
    for (const x0 of [60.2, 61.9]) {
      const desk = box(1.5, 0.04, 0.7, pm.white(), 0.005);
      desk.position.set(x0 + 0.75, -B + 0.74, 1.95);
      g.add(desk);
      for (const dx of [0.1, 1.4]) {
        const leg = box(0.04, 0.72, 0.6, pm.darkSteel(), 0.004);
        leg.position.set(x0 + dx, -B + 0.36, 1.95);
        g.add(leg);
      }
      // operators face inboard, toward the hutches
      for (let m = 0; m < 3; m++) {
        const scr = box(0.5, 0.3, 0.025, pm.screen(), 0.004);
        scr.position.set(x0 + 0.25 + m * 0.5, -B + 1.05, 1.72);
        scr.rotation.y = (m - 1) * 0.2;
        const st = box(0.04, 0.14, 0.04, pm.darkSteel(), 0.003);
        st.position.set(x0 + 0.25 + m * 0.5, -B + 0.83, 1.7);
        g.add(scr, st);
      }
      const chair = cyl(0.24, 0.06, pm.black(), 20);
      chair.position.set(x0 + 0.75, -B + 0.48, 2.6);
      const back = box(0.42, 0.45, 0.05, pm.black(), 0.01);
      back.position.set(x0 + 0.75, -B + 0.78, 2.83);
      const post = cyl(0.025, 0.45, pm.steel(), 10);
      post.position.set(x0 + 0.75, -B + 0.23, 2.6);
      g.add(chair, back, post);
    }
    place(shadowed(g), 0);
  }

  ctx.group.add(root);
}

export { pipeX };
