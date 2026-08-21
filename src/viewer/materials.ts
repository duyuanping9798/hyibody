import {
  AdditiveBlending,
  BackSide,
  Color,
  DoubleSide,
  FrontSide,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  ShaderMaterial,
  type Material,
} from 'three';
import type { SystemId } from '../data/types';
import paletteRaw from '../../content/palette.json';

/** 逐结构配色表（`content/palette.json`，`_meta` 之外的键都是 slug → 十六进制色）。 */
const PALETTE = paletteRaw as Record<string, string | { note?: string }>;

/** 各系统基色（深色舞台上的科普配色：动脉红/静脉蓝/神经黄/骨米白）。 */
export const SYSTEM_COLORS: Record<SystemId, number> = {
  // 2026-08-21 退回品牌青：BP3D 的皮肤已经到顶（203,382 面就是原生全部，
  // 且没有 UV、贴不了图），再细化只能换数据源。人类拍板"无法升级细化就直接去掉，
  // 回到原来的皮肤设计"——与其留一层想像人却不像人的塑料壳，
  // 不如退回一个不假装写实的抽象表达。肤色版是 0xcd9673，要恢复改这一行 + HyiViewer 的材质选择。
  skin: 0x4fc3d9,
  muscles: 0xc75948,
  skeleton: 0xd8d3c3,
  organs: 0xcf8a5b,
  vessels: 0xd64541,
  nerves: 0xe6cf4e,
};

/**
 * 值噪声（GLSL），皮肤与各系统表面共用一份。
 *
 * 流水线导出的 glb 只有 POSITION 和 NORMAL——**没有 UV，也没有任何贴图**
 * （解剖网格本来就不带 UV，2026-08-21 查过 muscles.glb 确认）。所以"给表面加质感"
 * 这件事只有一条路：在片元里按**世界坐标**取程序噪声。这段是那条路的地基。
 */
const HYI_NOISE_GLSL = `
         float hyiHash(vec3 p) {
           p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
           p *= 17.0;
           return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
         }
         float hyiNoise(vec3 x) {
           vec3 i = floor(x);
           vec3 f = fract(x);
           f = f * f * (3.0 - 2.0 * f);
           float n00 = mix(hyiHash(i), hyiHash(i + vec3(1.0, 0.0, 0.0)), f.x);
           float n10 = mix(hyiHash(i + vec3(0.0, 1.0, 0.0)), hyiHash(i + vec3(1.0, 1.0, 0.0)), f.x);
           float n01 = mix(hyiHash(i + vec3(0.0, 0.0, 1.0)), hyiHash(i + vec3(1.0, 0.0, 1.0)), f.x);
           float n11 = mix(hyiHash(i + vec3(0.0, 1.0, 1.0)), hyiHash(i + vec3(1.0, 1.0, 1.0)), f.x);
           return mix(mix(n00, n10, f.y), mix(n01, n11, f.y), f.z);
         }
         // 第二个八度换个朝向再采样。两层用同一套轴对齐格子时，凑近看是一片
         // 规整的方格纹——像布，不像组织。转一个不对称的角度就散开了。
         const mat3 HYI_TWIST = mat3(
           0.80, 0.36, -0.48,
           -0.48, 0.86, -0.16,
           0.36, 0.36, 0.86
         );
`;

/**
 * 世界坐标 varying 的注入片段（顶点着色器）。
 *
 * 合批时 `transformed` 留在几何体的**局部**空间——批矩阵是在 `project_vertex`
 * 里加到 `mvPosition` 上的，不是加到 `transformed` 上。漏掉它的后果不是"偏一点"：
 * glb 顶点是量化过的（局部坐标在 ±1 附近、真实尺寸全在节点 TRS 里），
 * 噪声的采样域会从 ±800 毫米塌成 ±1，按毫米调的频率在那个域上几乎是常数
 * ——皮肤直接变成一片光滑（合批改造后实拍出来的，见 DECISIONS.md）。
 */
function worldVaryingGlsl(name: string): string {
  return `
         #ifdef USE_BATCHING
           ${name} = (modelMatrix * batchingMatrix * vec4(transformed, 1.0)).xyz;
         #else
           ${name} = (modelMatrix * vec4(transformed, 1.0)).xyz;
         #endif`;
}

/** slug → [0,1) 的确定性伪随机（FNV-1a），保证同一结构每次配色一致。 */
function hash01(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x100000000;
}

/**
 * 同系统内的微小色相/明度抖动幅度。相邻肌肉若是同一个红，挨在一起就分不出边界；
 * 抖一点点既能看清"这是两块肌肉"，又不破坏系统配色identity。
 */
const TINT_SPREAD: Partial<Record<SystemId, { hue: number; light: number }>> = {
  muscles: { hue: 0.012, light: 0.1 },
  organs: { hue: 0.022, light: 0.09 },
  skeleton: { hue: 0.004, light: 0.05 },
};

/**
 * 结构基色（优先级：逐结构配色表 → 静脉蓝 → 系统色 + 微抖动）。
 *
 * `content/palette.json` 是人可编辑的逐结构配色：整个器官系统共用一个橙色时，
 * 心脏、肝、脾、胆囊挨在一起根本分不出谁是谁；按解剖图谱的习惯各给各的颜色，
 * 一眼就能认出来。没写进配色表的结构仍走系统色 + 确定性微抖动。
 */
export function colorForStructure(system: SystemId, en: string, key: string = en): number {
  const custom = PALETTE[key];
  if (typeof custom === 'string') {
    const hex = Number.parseInt(custom.replace('#', ''), 16);
    if (Number.isFinite(hex)) return hex;
  }
  const base =
    system === 'vessels' && /vein|venous|vena/i.test(en) ? 0x4a6fd6 : SYSTEM_COLORS[system];
  const spread = TINT_SPREAD[system];
  if (!spread) return base;
  const color = new Color(base);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  const dh = (hash01(key) - 0.5) * 2 * spread.hue;
  const dl = (hash01(`${key}#light`) - 0.5) * 2 * spread.light;
  color.setHSL((hsl.h + dh + 1) % 1, hsl.s, Math.min(0.94, Math.max(0.06, hsl.l * (1 + dl))));
  return color.getHex();
}

/** 常规结构材质（骨骼、器官等实体感）。 */
export function createStructureMaterial(color: string | number): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color(color),
    roughness: 0.55,
    metalness: 0.05,
    transparent: true,
  });
}

/**
 * 菲涅尔边缘光：给受光材质加一圈掠射角高光，并在低不透明度时补一点 alpha。
 *
 * 这样同一份材质既能当"实体"（不透明度高时看得清形状），又能当"X-ray 壳"
 * （不透明度低时只剩一圈发光的轮廓）。肌肉曾经用纯 X-ray 着色器，轮到肌肉层时
 * 只剩一圈红边、看不出肌肉走向；纯受光材质又没有透视感——这里两者兼得。
 */
function addFresnelRim(
  material: MeshStandardMaterial,
  options: {
    color: Color;
    strength: number;
    power: number;
    alpha: number;
    /**
     * 只在这一层开始透明时才亮起来（`1.0` = 完全按透明度渐入）。
     *
     * 皮肤要这个。不透明的皮肤上挂一圈青边，看着不是人，是全息投影——
     * 人类在手机上一眼就指出来了。但边缘光本身没错：它是"透视"这个身份的
     * 视觉签名，只是**应该在皮肤开始透的时候才出现**。用材质自己的 `opacity`
     * 当权重，分层滑块一动它自己就渐入，不需要额外的状态。
     */
    xrayOnly?: boolean;
  },
): void {
  const xrayOnly = options.xrayOnly === true;
  // 链式追加而不是直接赋值：这个函数原来是 `material.onBeforeCompile = ...`，
  // 一旦有第二个装饰器（比如下面的表面质感）加到同一个材质上，先加的那个会被
  // 整个吞掉——而且吞得无声无息，只有看像素才发现。cacheKey 同理。
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.uniforms.uRimColor = { value: options.color };
    shader.uniforms.uRimStrength = { value: options.strength };
    shader.uniforms.uRimPower = { value: options.power };
    shader.uniforms.uRimAlpha = { value: options.alpha };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform vec3 uRimColor;
         uniform float uRimStrength;
         uniform float uRimPower;
         uniform float uRimAlpha;
         void main() {`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         float rimFacing = abs(dot(normalize(vNormal), normalize(vViewPosition)));
         float rim = pow(1.0 - clamp(rimFacing, 0.0, 1.0), uRimPower);
         ${xrayOnly ? 'rim *= 1.0 - opacity;' : ''}
         gl_FragColor.rgb += uRimColor * rim * uRimStrength;
         gl_FragColor.a = clamp(gl_FragColor.a + rim * uRimAlpha * (1.0 - gl_FragColor.a), 0.0, 1.0);`,
      );
  };
  // onBeforeCompile 变了要让 three 重新编译
  const rimKey = `rim:${options.strength}:${options.power}:${options.alpha}:${xrayOnly ? 'x' : 'o'}`;
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${prevKey ? prevKey.call(material) : ''}|${rimKey}`;
}

/**
 * 按系统分质感（环境光照下的观感升级）：骨骼哑光、肌肉半哑光纤维感、
 * 器官/血管湿润高光带清漆层、神经缎面，全部带菲涅尔边缘光。
 * 只有皮肤走独立的 X-ray 菲涅尔壳（加色混合）。
 */
/** 各系统的边缘光参数：越靠外的层越需要"透"，边缘光就越强。 */
const RIM: Partial<
  Record<SystemId, { color: number; strength: number; power: number; alpha: number }>
> = {
  muscles: { color: 0xff9a7a, strength: 0.5, power: 2.6, alpha: 0.42 },
  skeleton: { color: 0xbfd8ff, strength: 0.26, power: 3.2, alpha: 0.2 },
  organs: { color: 0xffc79a, strength: 0.34, power: 2.8, alpha: 0.3 },
  vessels: { color: 0xff8f9a, strength: 0.42, power: 2.4, alpha: 0.34 },
  nerves: { color: 0xfff0a6, strength: 0.4, power: 2.4, alpha: 0.34 },
};

/**
 * 表面质感的档位：0 不注入（零成本）、1 便宜档、2 完整档。
 *
 * 这不是"锦上添花可以随便加"的东西——它是**每个片元**的开销，而全量之后
 * 手机默认档在肌肉层已经是 724 万三角面/帧。所以它跟画质档绑定：
 * `low`（软件渲染兜底、也是 e2e 用的档）完全不注入，e2e 因此不会变慢。
 */
export type SurfaceDetailLevel = 0 | 1 | 2;

/**
 * 各系统的表面参数。频率的单位是 1/毫米（世界坐标就是毫米）。
 *
 * `stretch` 是沿"纤维方向"的拉伸倍数：噪声沿这个方向变化慢、垂直方向变化快，
 * 于是出来的是**顺纹的沟**而不是一团麻点。肌肉最需要它，骨骼不需要（骨面是孔隙，
 * 各向同性），血管几乎不要（管子上出现顺纹会像波纹管）。
 *
 * `lo`/`hi` 是噪声两端的颜色乘子。刻意让**亮度基本不动、只动冷暖与饱和**——
 * 皮肤那一轮的教训：直接乘亮度系数出来的不是质感，是脏点（手机实拍一片灰斑）。
 */
const SURFACE: Partial<
  Record<
    SystemId,
    {
      freq: number;
      stretch: number;
      /** 第二个八度的频率倍数（只有档位 2 用） */
      fineMul: number;
      bump: number;
      rough: number;
      lo: [number, number, number];
      hi: [number, number, number];
    }
  >
> = {
  // 肌肉：顺纹方向取世界 Z（BP3D 的长轴——皮肤包围盒 Z 跨 ±865 毫米、X 只有 ±333，
  // 相机的 up 也设成 (0,0,1)）。腱膜偏白偏亮、肌腹偏深偏红。
  //
  // **这是"表面纹理"的近似，不是解剖学的肌纤维走向**，别在文案里说成后者：
  // 腹外斜肌、肋间肌的纤维本来就是斜行的，这里一律按长轴出纹。真要做对，
  // 得给每个结构存一个方向向量——而合批下每实例的通道已经被"颜色 + 不透明度"
  // 占满了，那是另一轮改造（记在 DECISIONS 待定）。
  muscles: {
    freq: 1 / 8,
    stretch: 9,
    fineMul: 3.4,
    bump: 1.2,
    rough: 0.3,
    // 明度摆幅收一半（原来 0.9↔1.1 共 22%）：那一档在近景里把几何自带的肌纤维沟
    // 盖住了，肌肉看着发闷、像有淤斑。冷暖差保留——真肌肉的不匀本来就是
    // 腱膜偏白偏黄、肌腹偏深偏红，不是忽明忽暗。
    lo: [1.06, 1.01, 0.96],
    hi: [0.94, 0.92, 0.95],
  },
  // 骨：孔隙是各向同性的，不能有方向
  skeleton: {
    freq: 1 / 6,
    stretch: 1,
    fineMul: 4.0,
    bump: 5.0,
    rough: 0.35,
    lo: [1.07, 1.05, 0.96],
    hi: [0.92, 0.92, 0.98],
  },
  // 器官：湿润、光滑，大尺度色斑为主，起伏要**很轻**。
  //
  // 1/√stretch 那条经验规则在这里失灵了：按它算器官该给 4.0（stretch 只有 1.6），
  // 实拍出来是油腻的团块和夸张的高光，像融化的塑料。原因是**规则漏了材质光泽度**——
  // 器官挂着 clearcoat 0.28 + sheen，镜面反射会把法线扰动放大好几倍，
  // 而骨骼那种半哑光材质不会。所以带清漆/高光的材质要另外往下压。
  organs: {
    freq: 1 / 16,
    stretch: 1.6,
    fineMul: 3.0,
    bump: 1.2,
    rough: 0.22,
    lo: [1.05, 0.99, 0.97],
    hi: [0.95, 0.97, 1.01],
  },
  // 血管：几乎不要纹路，只让高光碎——湿的管子靠的是高光的碎，不是表面的花
  vessels: {
    freq: 1 / 9,
    stretch: 2.5,
    fineMul: 2.5,
    bump: 2.5,
    rough: 0.34,
    lo: [1.06, 0.97, 0.97],
    hi: [0.94, 0.98, 1.04],
  },
  // 神经：细密顺纹（神经束），比肌肉细、比肌肉弱
  nerves: {
    freq: 1 / 5,
    stretch: 7,
    fineMul: 3.0,
    bump: 1.5,
    rough: 0.22,
    lo: [1.07, 1.04, 0.92],
    hi: [0.93, 0.94, 1.02],
  },
};

/**
 * 参数是量出来的，不是调出来的（2026-08-21）。
 *
 * 第一版全都订得很保守——怕重蹈皮肤那次"噪声变脏点"的覆辙。结果是**弱到不存在**：
 * 同机位 A/B 拍完，量相邻像素亮度差（局部对比度，纹理的直接度量），
 * 前景肋骨只有 1.06 倍、椎体反而 0.93 倍。眼睛以为看见了起伏，数字说没有。
 *
 * 算清了为什么：`e = 0.4 / freq` 是按周期取的差分，所以梯度大小与频率无关、
 * 幅度全在 `bump` 上。原来 bump = 0.32 只把法线偏了 3–5°，在柔和光照下
 * 就是几个百分点的明暗差——低于可辨阈值。现在 bump 抬到 2.0 量级（原始约 30–45°，
 * 过完距离淡出还剩 15–25°），颜色幅度从 ±3% 抬到 ±8%。
 *
 * 频率同时**降低**（骨 1/1.6 → 1/6 毫米、肌肉 1/3.2 → 1/8）。两个理由：
 * 一是人实际的观看距离下，读得出的是"骨面起伏""肌束"这一档尺度，不是亚毫米的孔隙；
 * 二是 `hyiBumpFade` 按频率淡出，频率越高淡得越狠——骨在 0.5 毫米/像素时
 * 原来只剩 0.53，现在是 0.88。
 *
 * **怎么定幅度（这一条我先写错过一次，改正记在这里）**：
 * 一开始定的标准是"同机位 A/B 的局部对比度要到 1.5 倍"。标定之后发现它是错的——
 * bump 从 2 抬到 20（十倍），指标只从 1.27× 走到 1.65×，而画面已经从"几乎看不出"
 * 变成"揉皱的锡纸"。局部对比度在这里被几何边缘和半透明叠加主导，比值被严重压缩。
 *
 * 所以：`scripts/surface-contrast.py` 用来回答**"这层效果到底有没有生效"**
 * （1.0× 就是没生效，第一版 1.06× 就是这么抓出来的），**不用来定幅度**。
 * 幅度靠同机位 A/B 的图判断，落点是"看得出骨面/肌束的起伏，但不到噪点"。
 * 骨骼那一档是在 2（太弱）与 20（太强，成了锡纸）之间取的 5.0。
 *
 * **`bump` 要跟着 `stretch` 反着走**（这条是拿肌肉撞出来的）：拉伸把噪声在
 * "横过纹理"方向压扁，等于把那个方向的有效频率放大了 stretch 倍，梯度跟着陡峭。
 * 骨骼 stretch=1 时 5.0 正好，肌肉 stretch=9 时同样的 5.0 直接糊成揉皱的玻璃纸。
 * 所以下面大致按 1/√stretch 缩。**但这条规则漏了材质光泽度**：器官挂着
 * clearcoat + sheen，镜面反射会把法线扰动再放大几倍，按规则算的 4.0 拍出来是
 * 融化的塑料，实测要压到 1.2。血管虽然更亮（clearcoat 0.6），但管子太细、
 * 噪声铺不开，2.5 反而没事——所以这一档只能一个个看图定，规则只用来起头。
 * 定稿：骨 5.0、血管 2.5、神经 1.5、肌肉 1.2、器官 1.2。
 * 肌肉本来也最不需要——BP3D 的网格自带肌纤维沟。
 */
/**
 * 按世界坐标给每个系统加一层程序化表面质感。
 *
 * **为什么非做不可**：2026-08-21 把 BP3D 拉到全量（236 万 → 478 万面）之后，
 * 人类的反馈是"似乎没有什么明显的区别"。量下来他也说对了——那一屏里腹外斜肌
 * 面数翻了三倍（74,990 → 223,584）、肋间肌 5.5 倍，肉眼分不出。原因是那个视距下
 * 三角形早就小于一个像素，**面数不再是瓶颈**。真正的瓶颈是：glb 只有
 * POSITION + NORMAL，一个系统一个材质一个颜色，除皮肤外没有任何表面变化——
 * 整片腹肌是同一个三文鱼粉，肌腱不反光、筋膜没明暗、骨面没质地。
 *
 * 所以这一层加的不是几何，是**着色**：零字节、不碰流水线、不动体积预算，
 * 代价只在片元开销上，并且按画质档分级。
 */
function addSurfaceDetail(
  material: MeshStandardMaterial,
  system: SystemId,
  level: SurfaceDetailLevel,
): void {
  const cfg = SURFACE[system];
  if (!cfg || level === 0) return;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.uniforms.uSurfFreq = { value: cfg.freq };
    shader.uniforms.uSurfStretch = { value: cfg.stretch };
    shader.uniforms.uSurfFine = { value: cfg.freq * cfg.fineMul };
    shader.uniforms.uSurfBump = { value: cfg.bump };
    shader.uniforms.uSurfRough = { value: cfg.rough };
    shader.uniforms.uSurfLo = { value: new Color(...cfg.lo) };
    shader.uniforms.uSurfHi = { value: new Color(...cfg.hi) };
    // 便宜档 / 完整档用 uniform 分支而不是编译期分支：高画质开关能在
    // medium ⇄ high 之间来回切，而材质是系统加载时就建好的——编译期分支意味着
    // 切了不生效，用户拨了开关却什么都没变。uniform 上的分支在 GPU 上不会发散
    //（整个 draw 走同一条路），代价可以忽略。
    shader.uniforms.uSurfFull = { value: level >= 2 ? 1 : 0 };
    material.userData.hyiSurfaceShader = shader;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vHyiSurf;\nvarying vec3 vHyiSurfN;\nvoid main() {')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>${worldVaryingGlsl('vHyiSurf')}`,
      )
      // 世界法线要自己算：片元里现成的 `vNormal` 是**视图空间**的，拿它去投影
      // 世界长轴，方向会跟着相机转——纹路会在转动时爬行。这里取 beginnormal_vertex
      // 之后、normalMatrix 之前的 objectNormal，只乘 model（与批）矩阵。
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
         #ifdef USE_BATCHING
           vHyiSurfN = normalize(mat3(modelMatrix) * mat3(batchingMatrix) * objectNormal);
         #else
           vHyiSurfN = normalize(mat3(modelMatrix) * objectNormal);
         #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vHyiSurf;
         varying vec3 vHyiSurfN;
         uniform float uSurfFreq;
         uniform float uSurfStretch;
         uniform float uSurfFine;
         uniform float uSurfBump;
         uniform float uSurfRough;
         uniform vec3 uSurfLo;
         uniform vec3 uSurfHi;
         uniform float uSurfFull;
${HYI_NOISE_GLSL}
         // 一个像素跨过好几个噪声周期时，细节只会退化成沙粒噪点。fwidth 给出
         // 这个像素在世界坐标里跨了多少毫米，据此把细节淡出。取三轴最大值而不是
         // 求和——求和会把同一个像素的跨度算成三倍，近景细节也跟着被淡光。
         float hyiFadeFor(vec3 w, float freq) {
           float mmPerPixel = max(max(fwidth(w.x), fwidth(w.y)), fwidth(w.z));
           return clamp(1.0 - mmPerPixel * freq * 1.5, 0.0, 1.0);
         }
         // 细八度按**细八度自己的频率**淡出（它先到 Nyquist）
         float hyiSurfFade(vec3 w) { return hyiFadeFor(w, uSurfFine); }
         // 法线扰动按**基础频率**淡出。这两个分开是必须的：骨骼的细八度是
         // 0.36 毫米，近景 0.23 毫米/像素时它的淡出系数已经只剩 0.03，而基础八度
         // （1.6 毫米的骨面起伏）还有 0.78。原来整个凹凸乘的是前者——于是骨头在
         // 近景下**一点起伏都没有**，正是"加了质感看不出变化"的原因。
         // medium 档更纯粹：它压根不算细八度，那个系数在那里只剩副作用。
         float hyiBumpFade(vec3 w) { return hyiFadeFor(w, uSurfFreq); }
         // 顺纹方向：把身体长轴（世界 Z）投影到当前切平面。
         // 法线几乎与长轴平行的地方（肌肉的起止端、骨骺）投影会退化，换个参考轴兜底。
         vec3 hyiFiberDir(vec3 n) {
           vec3 axis = vec3(0.0, 0.0, 1.0);
           vec3 t = axis - n * dot(n, axis);
           float len = length(t);
           return len > 1e-3 ? t / len : normalize(cross(n, vec3(1.0, 0.0, 0.0)));
         }
         // 沿 dir 把采样坐标压扁 → 噪声沿这个方向变化慢，出来的是顺纹的沟。
         // stretch = 1 时这一步是恒等变换（骨骼要的各向同性）。
         vec3 hyiStretch(vec3 w, vec3 dir) {
           return w - dir * dot(w, dir) * (1.0 - 1.0 / uSurfStretch);
         }
         float hyiSurfField(vec3 w, vec3 dir, float fade) {
           vec3 q = hyiStretch(w, dir);
           float n = hyiNoise(q * uSurfFreq);
           if (uSurfFull > 0.5) {
             n = n * 0.72 + hyiNoise(HYI_TWIST * q * uSurfFine) * 0.28 * fade;
           }
           return n;
         }
         void main() {`,
      )
      // 噪声场只算**一次**，颜色、粗糙度、法线三处共用。
      //
      // three 的片元 main 里顺序是 color_fragment → roughnessmap_fragment →
      // normal_fragment_begin，所以在第一处声明、后两处直接用就行（别加花括号，
      // 加了变量就出不了作用域）。第一版三处各算各的：完整档一个片元 12 次噪声
      // 取样、约 96 次 hash——而这是全量之后手机上每帧 724 万三角面要摊的成本。
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         vec3 hyiNrm = normalize(vHyiSurfN);
         vec3 hyiDir = hyiFiberDir(hyiNrm);
         float hyiFade = hyiSurfFade(vHyiSurf);
         float hyiField = hyiSurfField(vHyiSurf, hyiDir, hyiFade);
         diffuseColor.rgb *= mix(uSurfLo, uSurfHi, hyiField);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         roughnessFactor = clamp(roughnessFactor + (hyiField - 0.5) * uSurfRough, 0.04, 1.0);`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
         {
           // hyiNrm / hyiDir / hyiFade / hyiField 在 color_fragment 那处已经算好
           float e = 0.4 / max(uSurfFreq, 0.0001);
           vec3 g;
           if (uSurfFull > 0.5) {
             g = vec3(
               hyiSurfField(vHyiSurf + vec3(e, 0.0, 0.0), hyiDir, hyiFade),
               hyiSurfField(vHyiSurf + vec3(0.0, e, 0.0), hyiDir, hyiFade),
               hyiSurfField(vHyiSurf + vec3(0.0, 0.0, e), hyiDir, hyiFade)
             ) - hyiField;
           } else {
             // 便宜档只沿"横过纹理"的那个方向取一次差分：沟的观感几乎全部来自
             // 垂直纹路方向的起伏，另外两轴的贡献小得多。省两次噪声取样。
             vec3 across = normalize(cross(hyiNrm, hyiDir));
             g = across * (hyiSurfField(vHyiSurf + across * e, hyiDir, hyiFade) - hyiField);
           }
           // 世界空间求梯度，normal 在这里是视图空间的，所以要过 viewMatrix
           normal = normalize(normal - mat3(viewMatrix) * g * uSurfBump * hyiBumpFade(vHyiSurf));
         }`,
      );
  };
  const key = `surf:${system}`;
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${prevKey ? prevKey.call(material) : ''}|${key}`;
}

/**
 * 切换已建好的材质的表面质感档位（便宜 ⇄ 完整），不重新编译。
 *
 * 材质是系统加载时建的，而高画质开关随时能拨——所以档位必须能事后改。
 * `low` 档（level 0）压根没注入着色器，这里对它是空操作，也**不能**被拨上来：
 * `canToggleHighQuality` 不让 low 切档，那是"这台机器跑不动"的兜底。
 */
export function setSurfaceDetail(material: Material, level: SurfaceDetailLevel): void {
  const shader = (material as MeshStandardMaterial).userData?.hyiSurfaceShader as
    { uniforms?: Record<string, { value: unknown }> } | undefined;
  const u = shader?.uniforms?.uSurfFull;
  if (u) u.value = level >= 2 ? 1 : 0;
}

export function createSystemMaterial(
  system: SystemId,
  color: string | number,
  /** 表面质感档位，默认完整档；`low` 画质档传 0（见 QUALITY_CAPS.surfaceDetail） */
  surfaceDetail: SurfaceDetailLevel = 2,
): MeshStandardMaterial {
  const c = new Color(color);
  let material: MeshStandardMaterial;
  switch (system) {
    case 'skeleton':
      material = new MeshStandardMaterial({
        color: c,
        roughness: 0.58,
        metalness: 0.03,
        envMapIntensity: 0.8,
        transparent: true,
      });
      break;
    case 'muscles':
      // 肌肉：半哑光、略带次表面感的暖红，粗糙度高一点才不像塑料
      material = new MeshStandardMaterial({
        color: c,
        roughness: 0.68,
        metalness: 0.0,
        envMapIntensity: 0.85,
        transparent: true,
      });
      break;
    case 'organs':
      // 清漆/光泽/环境反射都收一档：叠满之后 #a83f3d 的心脏会被打成浅粉，
      // 逐结构配色就白配了
      material = new MeshPhysicalMaterial({
        color: c,
        roughness: 0.42,
        metalness: 0.0,
        clearcoat: 0.28,
        clearcoatRoughness: 0.45,
        sheen: 0.2,
        sheenColor: new Color(0xffd9c0),
        envMapIntensity: 0.7,
        transparent: true,
      });
      break;
    case 'vessels':
      material = new MeshPhysicalMaterial({
        color: c,
        roughness: 0.26,
        metalness: 0.0,
        clearcoat: 0.6,
        clearcoatRoughness: 0.3,
        envMapIntensity: 1.15,
        transparent: true,
      });
      break;
    case 'nerves':
      material = new MeshStandardMaterial({
        color: c,
        roughness: 0.42,
        metalness: 0.0,
        envMapIntensity: 0.9,
        transparent: true,
      });
      break;
    default:
      return createStructureMaterial(color);
  }
  // 顺序无所谓（两个装饰器都是链式的），但表面质感放在边缘光之后更好读：
  // 先定材质本体 → 再加表面 → 最后那圈"透视"签名
  addSurfaceDetail(material, system, surfaceDetail);
  const rim = RIM[system];
  if (rim) {
    addFresnelRim(material, {
      color: new Color(rim.color),
      strength: rim.strength,
      power: rim.power,
      alpha: rim.alpha,
    });
  }
  return material;
}

/**
 * 皮肤的微观细节：三平面程序噪声，不依赖 UV。
 *
 * 流水线导出的 glb 只有 POSITION 和 NORMAL，没有 UV（解剖网格本来也不带），
 * 所以贴图这条路走不通。改成在片元里按**世界坐标**取噪声：两个八度，
 * 粗的一层做皮下的起伏、细的一层做毛孔级的颗粒，再用有限差分求梯度扰动法线，
 * 顺带让粗糙度不均匀——皮肤最不像皮肤的地方，就是它光滑得像塑料。
 */
/**
 * 次表面散射的廉价近似：掠射角上加一层暖光。
 *
 * 真皮肤是半透的——耳廓、指缝、鼻翼被光穿过去会透出血色。完整的次表面散射
 * 在 WebGL2 里太贵（要多次模糊 irradiance），但**观感上最值钱的那一部分**
 * 恰恰只发生在边缘：光从侧后方钻进薄的地方再出来。所以只在菲涅尔边缘加一点
 * 暖色，就能把"蜡像/塑料"拉回"有血的肉"。
 *
 * 乘 `opacity`：皮肤一开始透明，这层暖光就该让位给 X-ray 的青边，
 * 两者不能同时在边缘上打架。
 */
function addSubsurfaceRim(
  material: MeshStandardMaterial,
  options: { color: Color; strength: number; power: number },
): void {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.uniforms.uSssColor = { value: options.color };
    shader.uniforms.uSssStrength = { value: options.strength };
    shader.uniforms.uSssPower = { value: options.power };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform vec3 uSssColor;
         uniform float uSssStrength;
         uniform float uSssPower;
         void main() {`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         {
           float sssFacing = abs(dot(normalize(vNormal), normalize(vViewPosition)));
           float sssRim = pow(1.0 - clamp(sssFacing, 0.0, 1.0), uSssPower);
           gl_FragColor.rgb += uSssColor * sssRim * uSssStrength * opacity;
         }`,
      );
  };
  const key = `sss:${options.strength}:${options.power}`;
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${prevKey ? prevKey.call(material) : ''}|${key}`;
}

function addSkinDetail(
  material: MeshStandardMaterial,
  options: { coarse: number; fine: number; strength: number; roughVariation: number },
): void {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.uniforms.uSkinCoarse = { value: options.coarse };
    shader.uniforms.uSkinFine = { value: options.fine };
    shader.uniforms.uSkinStrength = { value: options.strength };
    shader.uniforms.uSkinRough = { value: options.roughVariation };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vSkinWorld;\nvoid main() {')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>${worldVaryingGlsl('vSkinWorld')}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vSkinWorld;
         uniform float uSkinCoarse;
         uniform float uSkinFine;
         uniform float uSkinStrength;
         uniform float uSkinRough;
${HYI_NOISE_GLSL}
         // 细的那一层要按距离淡出：一个像素跨过好几个噪声周期时，它只会变成沙粒噪点。
         // fwidth 给出这个像素在世界坐标里跨了多少毫米，据此把细octave 关掉。
         float hyiSkinFade(vec3 w) {
           // 取三轴里最大的那个，不是求和：求和会把同一个像素的跨度算成三倍，
           // 结果凑到脸上细节也还是被淡光（实拍近景仍然一片光滑）。
           float mmPerPixel = max(max(fwidth(w.x), fwidth(w.y)), fwidth(w.z));
           return clamp(1.0 - mmPerPixel * uSkinFine * 1.5, 0.0, 1.0);
         }
         float hyiSkinField(vec3 w, float fade) {
           return hyiNoise(w * uSkinCoarse) * 0.7 + hyiNoise(HYI_TWIST * w * uSkinFine) * 0.3 * fade;
         }
         void main() {`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         float hyiSkinFadeV = hyiSkinFade(vSkinWorld);
         float hyiSkinN = hyiSkinField(vSkinWorld, hyiSkinFadeV);
         roughnessFactor = clamp(roughnessFactor + (hyiSkinN - 0.5) * uSkinRough, 0.04, 1.0);`,
      )
      // 肤色本身也不均匀：同一片皮肤有深有浅，纯色会立刻露出"这是个模型"。
      //
      // 原来是整体乘一个 0.93–1.07 的亮度系数——那只会把噪声变成**脏点**
      //（手机实拍上一片灰斑）。真皮肤的不均匀是**冷暖**的不均匀：血流多的地方偏红，
      //  脂肪厚的地方偏黄。改成在冷暖之间插值，亮度基本不动。
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         {
           float hyiTint = hyiSkinField(vSkinWorld, hyiSkinFade(vSkinWorld));
           diffuseColor.rgb *= mix(vec3(0.97, 0.975, 1.0), vec3(1.04, 0.99, 0.95), hyiTint);
         }`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
         {
           // 世界坐标下求梯度，再用 viewMatrix 转到视图空间——normal 在这里是视图空间的
           float fade = hyiSkinFade(vSkinWorld);
           float e = 0.35 / max(uSkinFine, 0.0001);
           float base = hyiSkinField(vSkinWorld, fade);
           vec3 g = vec3(
             hyiSkinField(vSkinWorld + vec3(e, 0.0, 0.0), fade),
             hyiSkinField(vSkinWorld + vec3(0.0, e, 0.0), fade),
             hyiSkinField(vSkinWorld + vec3(0.0, 0.0, e), fade)
           ) - base;
           normal = normalize(normal - mat3(viewMatrix) * g * uSkinStrength);
         }`,
      );
  };
  const key = `skin:${options.coarse}:${options.fine}:${options.strength}:${options.roughVariation}`;
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${prevKey ? prevKey.call(material) : ''}|${key}`;
}

/**
 * 皮肤材质：一层真的皮肤，而不是一只青色玻璃壳。
 *
 * 原来皮肤走 `createXRayMaterial`（加色混合的菲涅尔壳）。"透视"的身份是对的，
 * 但代价是分层滑到最外层时看到的不是人，是模特道具。现在改成受光的物理材质：
 * 暖调肤色 + 绒毛感 sheen + 一点点皮脂清漆 + 三平面噪声的毛孔，
 * 而"透视"交给分层滑块本来就在做的事——不透明度一降，菲涅尔边缘光接管，
 * 正对相机的部分透掉、只剩一圈青边，X-ray 的样子自己就回来了。
 */
export function createSkinMaterial(color: string | number): MeshPhysicalMaterial {
  const material = new MeshPhysicalMaterial({
    color: new Color(color),
    // 0.74 → 0.82：实拍下胸口和大腿的高光直接打成白色，皮肤没有那么亮
    roughness: 0.82,
    metalness: 0,
    // 绒毛：皮肤在掠射角下会有一层柔和的散射，缺了它怎么调都像塑料
    sheen: 0.65,
    sheenRoughness: 0.9,
    sheenColor: new Color(0xffd8c4),
    // 皮脂那一点点反光，多一分就成了汗
    clearcoat: 0.05,
    clearcoatRoughness: 0.9,
    // 0.72 → 0.55：手机实拍是一具**苍白的石膏像**。环境光是 RoomEnvironment，
    // 又白又匀，给多了整个人就被洗成灰白；压下去之后基色的暖调才回得来。
    envMapIntensity: 0.55,
    transparent: true,
    side: FrontSide,
    // 皮肤是一张 6 万面的减面外壳，精度不够：大隐静脉这类紧贴皮下的结构会从
    // 壳外面冒出来，在腿上留下一道红印（实拍可见）。把皮肤朝相机方向偏一点，
    // 让这类"只差零点几毫米"的穿模输掉深度测试。
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  // 边缘光只在皮肤开始透明时渐入。不透明的皮肤挂一圈青边看着不是人，是全息投影
  //（人类在手机上一眼指出来）；但它是"透视"的视觉签名，该留，只是要留在对的时候。
  addFresnelRim(material, {
    color: new Color(0x6fe0ee),
    strength: 0.42,
    power: 3.0,
    alpha: 0.55,
    xrayOnly: true,
  });
  // 边缘那一点暖光就是次表面散射最值钱的部分：光从侧后方钻进薄的地方再出来
  addSubsurfaceRim(material, { color: new Color(0xff7a52), strength: 0.11, power: 3.6 });
  // 尺度按毫米给：粗的一层周期约 30 mm（皮下起伏），细的约 4 mm（颗粒感）。
  // strength 是法线扰动的倍率——梯度本身只有 0.05 量级，0.35 的话肉眼根本看不出。
  // 4.0 在全身远景下会糊成沙粒（实拍可见），所以细的那一层按 fwidth 淡出，
  // 倍率降到 2.5：远看只剩皮下起伏，凑近才浮出颗粒。
  // 手机实拍的评价是"皮肤只是一个糙面"。三个数都调小了一档：
  // 30 mm 的起伏在一张脸上就是疙瘩（改成 70 mm，读作肌肉与脂肪的柔和高低）；
  // 4 mm 的毛孔在全身景下正好落在"半淡出"的尴尬区间、糊成沙粒（改成 2.2 mm，
  // 远景直接淡光、凑近才浮出来）；法线扰动的倍率砍掉一半——原来那个量级
  // 已经不是毛孔，是橘皮。
  addSkinDetail(material, {
    coarse: 1 / 70,
    fine: 1 / 2.2,
    strength: 1.3,
    roughVariation: 0.14,
  });
  return material;
}

/**
 * 选中描边：反壳法——同几何体沿法线外扩、背面渲染，形成稳定轮廓线。
 *
 * 外扩量在**视图空间**按深度换算成固定像素宽度，不能直接加在物体空间的 position 上：
 * 流水线用 KHR_mesh_quantization，每个节点自带缩放（皮肤那条是 859.88），
 * 物体空间加 2.2 会被放大成 1891 mm 的巨壳，把整个视口糊成青色（2026-08-18 修）。
 */
export function createOutlineMaterial(color: string | number, widthPx = 2.5): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new Color(color) },
      uWidthPx: { value: widthPx },
      // 2·tan(fov/2)/视口高度：把像素宽度换算成该深度处的世界尺寸，由 viewer 在 resize 时更新
      uPixelScale: { value: 0.001 },
      uOpacity: { value: 0.95 },
    },
    vertexShader: /* glsl */ `
      uniform float uWidthPx;
      uniform float uPixelScale;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        mv.xyz += n * (uWidthPx * uPixelScale * max(-mv.z, 0.0));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() {
        gl_FragColor = vec4(uColor, uOpacity);
      }
    `,
  });
}

/** 渐变舞台背景：内翻大球，深色底 + 顶部冷光晕，替代纯色清屏。 */
export function createBackdropMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      // 2026-08-20 按用户要求整体压暗：原来是 070b16 / 0b1020 / 14223c，
      // 顶部那档亮到人体一进画面就"浮"在灰蓝里。深色底才衬得住内脏的配色。
      uBottom: { value: new Color(0x02040a) },
      uMid: { value: new Color(0x05080f) },
      uTop: { value: new Color(0x0a1120) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBottom;
      uniform vec3 uMid;
      uniform vec3 uTop;
      varying vec3 vPos;
      void main() {
        float h = clamp(vPos.z / length(vPos) * 0.5 + 0.5, 0.0, 1.0);
        vec3 color = h < 0.5 ? mix(uBottom, uMid, h * 2.0) : mix(uMid, uTop, (h - 0.5) * 2.0);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
}

/**
 * 菲涅尔 X-ray 材质：边缘亮、正对相机处透明，呈现"透视"外壳效果。
 * 迁移自 prototype/index.html 已验证的思路，供皮肤/肌肉层使用。
 */
/**
 * X-ray 壳：加色混合的菲涅尔外壳，"透视"这个身份的视觉签名。
 *
 * 2026-08-21 人类拍板把皮肤退回这个设计：**"皮肤功能无法升级细化，就直接去掉，
 * 回到原来的皮肤设计。"** 起因是 BP3D 的皮肤已经到顶——203,382 面就是原生全部，
 * 而且没有 UV、贴不了图，再细化只能换数据源（CC0 体表，人类已暂停）。
 * 与其留一层"努力想像人却不像人"的塑料壳，不如退回一个不假装写实的抽象表达。
 *
 * **不能直接用回旧实现**：旧版是裸 `ShaderMaterial`，顶点着色器写死
 * `modelMatrix * vec4(position, 1.0)`，不认合批矩阵；而皮肤自 v1.1 起走
 * `BatchedMesh`，glb 顶点又是量化过的（局部坐标在 ±1 附近，真实尺寸全在节点 TRS 里）
 * ——直接用回去皮肤会缩成原点附近的一小团。
 *
 * 所以改挂在 `MeshBasicMaterial` 上：它自带 `batching_vertex`，
 * 每实例的颜色与不透明度也照旧走 `setColorAt` → `vColor`（`diffuseColor` 里
 * 已经乘好了），而且没有光照计算——这一层铺满整屏，省下的是实打实的片元开销。
 */
export function createXRayMaterial(color: string | number, opacity = 1): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    color: new Color(color),
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    opacity,
    vertexColors: true,
  });
  material.onBeforeCompile = (shader) => {
    // 边缘收窄（2.2 → 2.7）：叠在百万面的内脏之上时，宽边缘会把画面糊白
    shader.uniforms.uXrayPower = { value: 2.7 };
    // 加色混合的总强度，低一点才压得住内层的高光
    shader.uniforms.uXrayIntensity = { value: 0.85 };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vXrayW;\nvarying vec3 vXrayN;\nvoid main() {')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>${worldVaryingGlsl('vXrayW')}`,
      )
      // 世界法线自己算：basic 材质的片元里没有现成的法线 varying。
      //
      // **注意注入点**：不能挂在 `<beginnormal_vertex>` 之后——在 basic 的顶点
      // 着色器里那一句被包在 `#if defined(USE_ENVMAP) || defined(USE_SKINNING)`
      // 里，而我们两个都没有，整段会被预处理器编译掉，`vXrayN` 永远不被赋值。
      // 后果不是报错而是**静默失效**：normalize(未初始化) 得到 NaN，片元 alpha
      // 也成 NaN，皮肤一个像素都画不出来，而着色器编译得好好的。
      // 挂在 `<batching_vertex>` 之后（无条件执行），并直接用 `normal` 属性——
      // 它在 three 的顶点前缀里是无条件声明的。
      .replace(
        '#include <batching_vertex>',
        `#include <batching_vertex>
         #ifdef USE_BATCHING
           vXrayN = normalize(mat3(modelMatrix) * mat3(batchingMatrix) * normal);
         #else
           vXrayN = normalize(mat3(modelMatrix) * normal);
         #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vXrayW;
         varying vec3 vXrayN;
         uniform float uXrayPower;
         uniform float uXrayIntensity;
         void main() {`,
      )
      // 最后一步整个改写输出：颜色与逐实例不透明度都已经在 diffuseColor 里
      //（材质本体给白色，真正的颜色由 setColorAt 乘进来），这里只叠菲涅尔
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         {
           vec3 viewDirW = normalize(cameraPosition - vXrayW);
           float fresnel = pow(1.0 - abs(dot(normalize(vXrayN), viewDirW)), uXrayPower);
           gl_FragColor = vec4(diffuseColor.rgb, fresnel * uXrayIntensity * diffuseColor.a);
         }`,
      );
  };
  material.customProgramCacheKey = () => 'xray';
  return material;
}

/** 统一设置材质整体不透明度（分层滑块用）。 */
export function setMaterialOpacity(material: Material, opacity: number): void {
  if (material instanceof ShaderMaterial && material.uniforms.uOpacity) {
    material.uniforms.uOpacity.value = opacity;
  } else if ('opacity' in material) {
    material.opacity = opacity;
    // 半透明叠加时关闭深度写入，减少互相遮挡的闪面
    material.depthWrite = opacity > 0.55;
    // 完全不透明时关掉混合：留着 transparent 的话，选中的器官后面会透出肋骨，
    // 看着像磨砂玻璃而不是实体
    const solid = opacity >= 0.999;
    if (material.transparent === solid) {
      material.transparent = !solid;
      material.needsUpdate = true;
    }
  }
  material.visible = opacity > 0.005;
}
