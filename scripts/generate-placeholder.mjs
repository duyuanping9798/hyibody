// 生成占位人形 glb：胶囊躯干 + 球头 + 四肢圆柱，写入 public/assets/placeholder.glb。
// M1 数据流水线产出真实解剖 glb 后，此脚本与占位模型即退役。
// 坐标系对齐 BodyParts3D：单位毫米、Z 轴向上、前方 -Y（KICKOFF 第 5 节 M1-3）。
import { Document, NodeIO } from '@gltf-transform/core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// M1 起 manifest.json 由流水线生成并提交仓库；存在真实数据时跳过占位生成，
// 避免 dev/test/build 前置脚本覆盖流水线产物。
try {
  const existing = JSON.parse(await readFile(path.resolve('public/assets/manifest.json'), 'utf8'));
  if (existing.systems?.length && existing.systems[0].id !== 'placeholder') {
    console.log('检测到流水线 manifest.json，跳过占位模型生成');
    process.exit(0);
  }
} catch {
  // manifest 不存在或损坏 → 照常生成占位
}
import { CapsuleGeometry, CylinderGeometry, Matrix4, SphereGeometry, Vector3 } from 'three';

/** three.js BufferGeometry（Y-up）→ 变换后的扁平数组（Z-up 场景中摆放） */
function bake(geometry, matrix) {
  const g = geometry.toNonIndexed ? geometry : geometry;
  g.applyMatrix4(matrix);
  return {
    position: new Float32Array(g.getAttribute('position').array),
    normal: new Float32Array(g.getAttribute('normal').array),
    indices: g.index ? new Uint32Array(g.index.array) : null,
  };
}

const mm = (x) => x; // 语义标注：数值单位为毫米

// 人体近似尺寸（成人 ~1700 mm 高，脚底 z=0）
const parts = [
  // 躯干
  bake(
    new CapsuleGeometry(mm(160), mm(420), 8, 24),
    new Matrix4()
      .makeRotationX(Math.PI / 2)
      .premultiply(new Matrix4().makeTranslation(0, 0, mm(1180))),
  ),
  // 头
  bake(new SphereGeometry(mm(110), 24, 18), new Matrix4().makeTranslation(0, 0, mm(1580))),
  // 左右腿
  ...[-1, 1].map((s) =>
    bake(
      new CylinderGeometry(mm(70), mm(55), mm(820), 16),
      new Matrix4()
        .makeRotationX(Math.PI / 2)
        .premultiply(new Matrix4().makeTranslation(mm(s * 105), 0, mm(480))),
    ),
  ),
  // 左右臂（自然下垂，稍外展）
  ...[-1, 1].map((s) =>
    bake(
      new CylinderGeometry(mm(48), mm(40), mm(640), 16),
      new Matrix4()
        .makeRotationX(Math.PI / 2)
        .premultiply(new Matrix4().makeRotationY((s * Math.PI) / 22))
        .premultiply(new Matrix4().makeTranslation(mm(s * 250), 0, mm(1120))),
    ),
  ),
];

// 合并为单 mesh
let vertCount = 0;
let idxCount = 0;
for (const p of parts) {
  vertCount += p.position.length / 3;
  idxCount += p.indices ? p.indices.length : p.position.length / 3;
}
const position = new Float32Array(vertCount * 3);
const normal = new Float32Array(vertCount * 3);
const indices = new Uint32Array(idxCount);
let vOff = 0;
let iOff = 0;
for (const p of parts) {
  position.set(p.position, vOff * 3);
  normal.set(p.normal, vOff * 3);
  const n = p.position.length / 3;
  if (p.indices) {
    for (let i = 0; i < p.indices.length; i++) indices[iOff + i] = p.indices[i] + vOff;
    iOff += p.indices.length;
  } else {
    for (let i = 0; i < n; i++) indices[iOff + i] = vOff + i;
    iOff += n;
  }
  vOff += n;
}

// 居中到原点（保留 z 高度居中，便于轨道旋转取景）
const box = {
  min: new Vector3(Infinity, Infinity, Infinity),
  max: new Vector3(-Infinity, -Infinity, -Infinity),
};
for (let i = 0; i < position.length; i += 3) {
  box.min.x = Math.min(box.min.x, position[i]);
  box.min.y = Math.min(box.min.y, position[i + 1]);
  box.min.z = Math.min(box.min.z, position[i + 2]);
  box.max.x = Math.max(box.max.x, position[i]);
  box.max.y = Math.max(box.max.y, position[i + 1]);
  box.max.z = Math.max(box.max.z, position[i + 2]);
}
const center = new Vector3().addVectors(box.min, box.max).multiplyScalar(0.5);
for (let i = 0; i < position.length; i += 3) {
  position[i] -= center.x;
  position[i + 1] -= center.y;
  position[i + 2] -= center.z;
}

const doc = new Document();
const buffer = doc.createBuffer();
const posAccessor = doc.createAccessor().setType('VEC3').setArray(position).setBuffer(buffer);
const normAccessor = doc.createAccessor().setType('VEC3').setArray(normal).setBuffer(buffer);
const idxAccessor = doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer);
const material = doc.createMaterial('placeholder').setBaseColorFactor([0.62, 0.72, 0.85, 1]);
const prim = doc
  .createPrimitive()
  .setAttribute('POSITION', posAccessor)
  .setAttribute('NORMAL', normAccessor)
  .setIndices(idxAccessor)
  .setMaterial(material);
const mesh = doc.createMesh('placeholder_body').addPrimitive(prim);
const node = doc.createNode('placeholder_body').setMesh(mesh);
node.setExtras({
  slug: 'placeholder_body',
  zh: '占位人体',
  en: 'Placeholder body',
  system: 'placeholder',
  region: 'whole',
  side: 'none',
  fma: [],
  source: 'placeholder',
});
doc.createScene('hyibody').addChild(node);

const outDir = path.resolve('public/assets');
await mkdir(outDir, { recursive: true });
const glb = await new NodeIO().writeBinary(doc);
const outFile = path.join(outDir, 'placeholder.glb');
await writeFile(outFile, glb);

const bbox = [
  box.min.x - center.x,
  box.min.y - center.y,
  box.min.z - center.z,
  box.max.x - center.x,
  box.max.y - center.y,
  box.max.z - center.z,
].map((v) => Math.round(v));
const manifest = {
  version: '0.0.1',
  generatedAt: new Date().toISOString(),
  systems: [
    {
      id: 'placeholder',
      file: 'assets/placeholder.glb',
      bytes: glb.byteLength,
      structures: ['placeholder_body'],
    },
  ],
  structures: {
    placeholder_body: {
      zh: '占位人体',
      en: 'Placeholder body',
      system: 'placeholder',
      region: 'whole',
      side: 'none',
      fma: [],
      source: 'placeholder',
      bbox,
    },
  },
  attribution: ['占位模型由程序生成（scripts/generate-placeholder.mjs），无第三方数据。'],
};
await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`placeholder.glb ${(glb.byteLength / 1024).toFixed(1)} KB, ${idxCount / 3} triangles`);
