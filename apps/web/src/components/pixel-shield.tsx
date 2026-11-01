// 1-bit animated shield: projectiles fly in, shatter on the shield, the shield takes
// the hit, a scan line sweeps the inside. Pure SVG + CSS (steps() timing), two colours.

const W = 24;
const H = 28;
const OX = 38; // shield origin inside the 64x40 viewBox
const OY = 6;

const halfWidth = (y: number) => (y <= 15 ? 11.5 : 11.5 - (y - 15) * 0.95);
function inside(x: number, y: number) {
  if (x < 0 || y < 0 || x >= W || y >= H) return false;
  const d = Math.abs(x + 0.5 - W / 2);
  if (y === 0 && d > 10.5) return false; // rounded top corners
  return d <= halfWidth(y);
}

// paper-coloured check mark, two pixels thick
const CHECK = [
  [6, 13], [7, 14], [8, 15], [9, 16], [10, 15], [11, 14], [12, 13], [13, 12], [14, 11], [15, 10], [16, 9], [17, 8],
].flatMap(([x, y]) => [`${x},${y}`, `${x},${y + 1}`]);
const checkSet = new Set(CHECK);

type Px = { x: number; y: number };

function shieldPixels() {
  const ink: Px[] = [];
  const near = (x: number, y: number, r: number) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (!inside(x + dx, y + dy)) return true;
    return false;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inside(x, y)) continue;
      const outline = !inside(x + 1, y) || !inside(x - 1, y) || !inside(x, y + 1) || !inside(x, y - 1);
      if (outline) {
        ink.push({ x, y });
        continue;
      }
      if (near(x, y, 2)) continue; // 1px paper gap inside the outline
      if (checkSet.has(`${x},${y}`)) continue; // emblem stays paper
      if (y > 19 && (x + y) % 2 === 0) continue; // dithered lower half
      ink.push({ x, y });
    }
  }
  return ink;
}

const SHIELD = shieldPixels();
const CLIP = Array.from({ length: H }, (_, y) => {
  const xs = Array.from({ length: W }, (_, x) => x).filter((x) => inside(x, y));
  return xs.length ? { y, x0: xs[0], w: xs.length } : undefined;
}).filter((r) => r !== undefined);

// rows (shield-local) where projectiles strike; negative delays start every shot
// mid-flight, so impacts land at 0.8s, 1.8s, 2.8s of each 3s cycle
const SHOTS = [
  { row: 5, delay: 0 },
  { row: 10, delay: -1 },
  { row: 14, delay: -2 },
];
const SHARDS = [
  { dx: -4, dy: -3 }, { dx: -6, dy: 0 }, { dx: -4, dy: 3 }, { dx: -2, dy: -5 }, { dx: -2, dy: 5 },
];

export function PixelShield({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 40" className={`pixel-shield ${className}`} shapeRendering="crispEdges" role="img" aria-label="Pixel shield deflecting incoming attacks">
      <defs>
        <clipPath id="shield-clip">
          {CLIP.map((r) => <rect key={r!.y} x={OX + r!.x0} y={OY + r!.y} width={r!.w} height={1} />)}
        </clipPath>
      </defs>

      {/* ground line, dashed */}
      {Array.from({ length: 16 }, (_, i) => <rect key={i} x={i * 4} y={38} width={2} height={1} fill="#000" />)}

      {SHOTS.map((s, i) => {
        const y = OY + s.row;
        const hitX = OX - 3; // just left of the outline
        return (
          <g key={i}>
            <g className="ps-shot" style={{ animationDelay: `${s.delay}s`, ['--travel' as string]: `${hitX}px` }}>
              <rect x={0} y={y - 1} width={2} height={2} fill="#000" />
              <rect x={-3} y={y} width={1} height={1} fill="#000" />
              <rect x={-6} y={y - 1} width={1} height={1} fill="#000" />
              <rect x={-9} y={y} width={1} height={1} fill="#000" />
            </g>
            {SHARDS.map((d, j) => (
              <rect
                key={j}
                className="ps-shard"
                x={hitX + 1}
                y={y}
                width={1}
                height={1}
                fill="#000"
                style={{ animationDelay: `${s.delay}s`, ['--dx' as string]: `${d.dx}px`, ['--dy' as string]: `${d.dy}px` }}
              />
            ))}
          </g>
        );
      })}

      <g className="ps-body">
        {SHIELD.map((p) => <rect key={`${p.x}-${p.y}`} x={OX + p.x} y={OY + p.y} width={1} height={1} fill="#000" />)}
        <g clipPath="url(#shield-clip)">
          <rect className="ps-scan" x={OX} y={OY} width={W} height={1} fill="#fff" />
        </g>
      </g>
    </svg>
  );
}
