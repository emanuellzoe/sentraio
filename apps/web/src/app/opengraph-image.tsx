import { ImageResponse } from 'next/og';

// Social card: the headline over a strip of blue ASCII, in the site's palette.
export const alt = 'Sentraio — AI agents can hold money now. Sentraio decides what they may do with it.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const ROWS = [
  '  .:+@@@++:.        ::++@@+:.     .:++@@@@++::.   ..:+@@@+:.    ',
  ' :+@@@@@@@@+:.    .:+@@@@@@@+:.  :+@@@@@@@@@@@+: .:+@@@@@@@+:.  ',
  '.+@@@@@@@@@@@+:  :+@@@@@@@@@@@+ +@@@@@@@@@@@@@@@:+@@@@@@@@@@@+. ',
  ' :+@@@@@@@@+:.    .:+@@@@@@@+:.  :+@@@@@@@@@@@+: .:+@@@@@@@+:.  ',
  '  .:+@@@++:.        ::++@@+:.     .:++@@@@++::.   ..:+@@@+:.    ',
];

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#ffffff', padding: '72px 80px 56px', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 20, letterSpacing: 3, color: '#6b6b6b', fontFamily: 'monospace' }}>AGENT SECURITY ON NEAR</div>
          <div style={{ marginTop: 28, fontSize: 64, lineHeight: 1.05, letterSpacing: -2.5, color: '#6b6b6b', fontWeight: 500 }}>AI agents can hold money now.</div>
          <div style={{ fontSize: 64, lineHeight: 1.05, letterSpacing: -2.5, color: '#0a0a0a', fontWeight: 500 }}>Sentraio decides what they may do with it.</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', color: '#0000ff', fontFamily: 'monospace', fontSize: 18, lineHeight: 1.1, whiteSpace: 'pre' }}>
          {ROWS.map((r, i) => <div key={i}>{r}</div>)}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, letterSpacing: 2, color: '#6b6b6b', fontFamily: 'monospace' }}>
          <span>SENTRAIO.VERCEL.APP</span>
          <span>CLEARANCE · VAULT · TX X-RAY</span>
        </div>
      </div>
    ),
    size,
  );
}
