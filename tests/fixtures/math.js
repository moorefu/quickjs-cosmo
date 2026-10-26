export const answer = 42;
export function sum(values) { return values.reduce((a, b) => a + b, 0); }
export default class Point {
    constructor(x, y) { this.x = x; this.y = y; }
    get length() { return Math.hypot(this.x, this.y); }
}
