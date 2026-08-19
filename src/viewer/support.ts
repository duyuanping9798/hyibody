/**
 * 能力检测。three 0.185 已经彻底移除 WebGL1 路径，拿不到 webgl2 上下文就没得跑，
 * 得给一句说人话的提示——原来会落到"模型加载失败，请刷新重试"，刷一万次也没用。
 */
export function hasWebGL2(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    // 拿到就主动还回去，别白占一个上下文（浏览器同时能开的数量有限）
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
