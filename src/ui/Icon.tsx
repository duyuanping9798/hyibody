/**
 * 顶栏图标。用内联 SVG 而不是字符：中文字体是按 content/ 实际用字裁出来的子集，
 * ⌕ ↗ ⓘ 这类符号不在里面，浏览器回退时大小对不齐，个别设备直接掉成豆腐块。
 */
const COMMON = {
  width: 15,
  height: 15,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function SearchIcon() {
  return (
    <svg {...COMMON}>
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2 14 14" />
    </svg>
  );
}

export function ShareIcon() {
  return (
    <svg {...COMMON}>
      <path d="M6 2.5h7.5V10" />
      <path d="M13.5 2.5 7 9" />
      <path d="M11 13.5H2.5V5" />
    </svg>
  );
}

export function InfoIcon() {
  return (
    <svg {...COMMON}>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 7.2v4" />
      <path d="M8 4.8h.01" />
    </svg>
  );
}
