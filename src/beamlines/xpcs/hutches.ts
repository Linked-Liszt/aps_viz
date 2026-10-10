import * as THREE from 'three';
import { CR_WALL } from './geom';
import { box, shadowed, xm } from './kit';

/**
 * Furniture of the wedge-shaped 8-ID control room on the outboard side (2021 plan): desks with monitors along the diagonal
 * aisle wall. The room itself (floor and low outline) is drawn by the engine from OUTLINE_CR (style 'room').
 */
export function controlRoomFurniture(beamY: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'xpcs-control-room-furniture';
  const y0 = -beamY;
  // desks along the aisle wall, chairs on the hutch side
  const ang = Math.atan2(CR_WALL(60) - CR_WALL(50), 10); // wall direction in x–z
  for (const x of [57.9, 59.5, 61.1, 64.4, 66.0, 67.6]) {
    const zWall = CR_WALL(x);
    const desk = new THREE.Group();
    const top = box(1.4, 0.04, 0.7, xm.desk(), 0.01);
    top.position.y = 0.74;
    desk.add(top);
    for (const sx of [-0.62, 0.62]) {
      const leg = box(0.04, 0.72, 0.6, xm.desk(), 0.004);
      leg.position.set(sx, 0.36, 0);
      desk.add(leg);
    }
    for (const sx of [-0.35, 0.05, 0.42]) {
      const mon = box(0.5, 0.3, 0.03, xm.black(), 0.01);
      mon.position.set(sx, 1.0, 0.22);
      mon.rotation.y = Math.PI;
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.26), xm.screen());
      scr.position.set(sx, 1.0, 0.2);
      scr.rotation.y = Math.PI;
      const stem = box(0.04, 0.15, 0.04, xm.black(), 0.004);
      stem.position.set(sx, 0.83, 0.24);
      desk.add(mon, scr, stem);
    }
    const chair = new THREE.Group();
    const seat = box(0.45, 0.08, 0.45, xm.black(), 0.02);
    seat.position.y = 0.48;
    const back = box(0.45, 0.5, 0.06, xm.black(), 0.02);
    back.position.set(0, 0.78, -0.22);
    const pole = box(0.05, 0.44, 0.05, xm.steel(), 0.004);
    pole.position.y = 0.22;
    chair.add(seat, back, pole);
    chair.position.set(0, 0, -0.75);
    desk.add(chair);
    desk.position.set(x, y0, zWall - 0.55);
    desk.rotation.y = -ang;
    g.add(desk);
  }
  return shadowed(g);
}
