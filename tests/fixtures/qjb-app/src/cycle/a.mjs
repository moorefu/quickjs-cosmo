import { b } from './b.mjs';
export function a(){return 'A';}
export function cycle(){return a()+b();}
