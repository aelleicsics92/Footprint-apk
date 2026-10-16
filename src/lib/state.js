import { bus } from './util.js';
let target = null; // id waypoint
export const getTarget = () => target;
export function setTarget(id) {
  target = id;
  bus.emit('target:changed', id);
}
