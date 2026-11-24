// Where people can walk: a coarse grid over the town with the buildings
// blocked out, A* through it (8 neighbours, octile distance) and the path
// pulled straight wherever the line of sight is clear. Pure: no Phaser.
// Our own few lines rather than a library; the town is small.

export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

export class Grid {
  readonly cell: number;
  readonly x0: number;
  readonly y0: number;
  readonly cols: number;
  readonly rows: number;
  private blocked: Uint8Array;

  constructor(bounds: Rect, cell = 24) {
    this.cell = cell;
    this.x0 = bounds.x;
    this.y0 = bounds.y;
    this.cols = Math.max(1, Math.ceil(bounds.w / cell));
    this.rows = Math.max(1, Math.ceil(bounds.h / cell));
    this.blocked = new Uint8Array(this.cols * this.rows);
  }

  /** Block a rectangle (a building's footprint), grown by `pad`. */
  block(r: Rect, pad = 0) {
    const c0 = Math.max(0, Math.floor((r.x - pad - this.x0) / this.cell)), c1 = Math.min(this.cols - 1, Math.floor((r.x + r.w + pad - this.x0) / this.cell));
    const r0 = Math.max(0, Math.floor((r.y - pad - this.y0) / this.cell)), r1 = Math.min(this.rows - 1, Math.floor((r.y + r.h + pad - this.y0) / this.cell));
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) this.blocked[row * this.cols + col] = 1;
  }

  /** Block a circle (the sorting hall). */
  blockCircle(c: Pt, radius: number) {
    this.block({ x: c.x - radius, y: c.y - radius, w: radius * 2, h: radius * 2 });
  }

  private index(p: Pt) {
    const col = Math.floor((p.x - this.x0) / this.cell), row = Math.floor((p.y - this.y0) / this.cell);
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return -1;
    return row * this.cols + col;
  }

  private centre(i: number): Pt {
    return { x: this.x0 + ((i % this.cols) + 0.5) * this.cell, y: this.y0 + (Math.floor(i / this.cols) + 0.5) * this.cell };
  }

  walkable(p: Pt) {
    const i = this.index(p);
    return i >= 0 && !this.blocked[i];
  }

  /** The nearest walkable cell's centre to a point (a door, a bench just by a wall). */
  nearestWalkable(p: Pt): Pt | undefined {
    if (this.walkable(p)) return p;
    for (let r = 1; r < 12; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const q = { x: p.x + dx * this.cell, y: p.y + dy * this.cell };
        if (this.walkable(q)) return this.centre(this.index(q));
      }
    }
    return undefined;
  }

  /** Clear sight between two points: every cell along the segment walkable. */
  clear(a: Pt, b: Pt) {
    const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.ceil(d / (this.cell / 3));
    for (let k = 0; k <= n; k++) if (!this.walkable({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })) return false;
    return true;
  }

  /** A walkable path from a to b (a and b included), or undefined. Bounded work: at most `budget` cells opened. */
  path(a: Pt, b: Pt, budget = 6000): Pt[] | undefined {
    const from = this.nearestWalkable(a), to = this.nearestWalkable(b);
    if (!from || !to) return undefined;
    if (this.clear(from, to)) return [from, to];
    const start = this.index(from), goal = this.index(to);
    const n = this.cols * this.rows;
    const g = new Float32Array(n).fill(Infinity), came = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
    const heap: [number, number][] = [];
    const push = (f: number, i: number) => {
      heap.push([f, i]);
      let k = heap.length - 1;
      while (k > 0) { const p = (k - 1) >> 1; if (heap[p]![0] <= f) break; [heap[p], heap[k]] = [heap[k]!, heap[p]!]; k = p; }
    };
    const pop = () => {
      const top = heap[0]!, last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1;
          let m = k;
          if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
          if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k]!, heap[m]!];
          k = m;
        }
      }
      return top[1];
    };
    const gc = goal % this.cols, gr = Math.floor(goal / this.cols);
    const h = (i: number) => { const dx = Math.abs((i % this.cols) - gc), dy = Math.abs(Math.floor(i / this.cols) - gr); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
    g[start] = 0;
    push(h(start), start);
    let opened = 0;
    while (heap.length) {
      const i = pop();
      if (closed[i]) continue;
      if (i === goal) break;
      closed[i] = 1;
      if (++opened > budget) return undefined;
      const c = i % this.cols, r = Math.floor(i / this.cols);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const cc = c + dx, rr = r + dy;
        if (cc < 0 || rr < 0 || cc >= this.cols || rr >= this.rows) continue;
        const j = rr * this.cols + cc;
        if (this.blocked[j] || closed[j]) continue;
        // No cutting a building's corner.
        if (dx && dy && (this.blocked[r * this.cols + cc] || this.blocked[rr * this.cols + c])) continue;
        const ng = g[i]! + (dx && dy ? 1.414 : 1);
        if (ng < g[j]!) { g[j] = ng; came[j] = i; push(ng + h(j), j); }
      }
    }
    if (came[goal] === -1) return undefined;
    const cells: Pt[] = [];
    for (let i = goal; i !== -1; i = came[i]!) cells.push(this.centre(i));
    cells.reverse();
    cells[0] = from;
    cells[cells.length - 1] = to;
    // Pull the string: keep only the corners the line of sight needs.
    const out: Pt[] = [cells[0]!];
    let k = 0;
    while (k < cells.length - 1) {
      let far = k + 1;
      for (let j = cells.length - 1; j > k + 1; j--) if (this.clear(cells[k]!, cells[j]!)) { far = j; break; }
      out.push(cells[far]!);
      k = far;
    }
    return out;
  }
}
