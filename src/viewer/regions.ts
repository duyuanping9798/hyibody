/**
 * 「点在皮肤上，告诉我这是身体的哪儿、底下是什么」。
 *
 * 皮肤在数据里是**一整张外壳**，只有一个结构 `skin`。点头顶和点小腿弹出的是
 * 同一张卡片，写着同一句"皮肤是人体最大的器官"——对科普来说这是一条死路。
 *
 * 解法不是把皮肤切成十几块（那要改流水线、改预算、还要给每块写文案），
 * 而是**从命中点反查**：离这个点最近的几个结构是谁，它们属于哪个部位。
 * 数据现成的（每个结构都有 `region` 与包围盒），不用新增一个字节的资产。
 *
 * 顺带白拿一个更有用的东西：**这层皮下面是什么**。点胸口告诉你"胸骨、第 3 肋、
 * 心脏"，皮肤于是从死路变成了入口。
 *
 * 纯函数、只吃数字，不碰 three 也不碰 DOM——包围盒用的就是 manifest 里那六个数。
 */

import type { Region } from '../data/types';

/** manifest 里的包围盒格式：[minX, minY, minZ, maxX, maxY, maxZ]（毫米）。 */
export type Bbox = readonly [number, number, number, number, number, number];

export interface ProbeTarget {
  slug: string;
  region: Region;
  bbox: Bbox;
}

export interface ProbeResult {
  /** 最近那个结构所属的部位；一个都没找到时是 null */
  region: Region | null;
  /** 由近及远的结构 slug，用来回答"这下面是什么" */
  nearby: string[];
}

/** 点到轴对齐包围盒的距离（在盒内为 0）。 */
export function distanceToBox(point: readonly [number, number, number], box: Bbox): number {
  const dx = Math.max(box[0] - point[0], 0, point[0] - box[3]);
  const dy = Math.max(box[1] - point[1], 0, point[1] - box[4]);
  const dz = Math.max(box[2] - point[2], 0, point[2] - box[5]);
  return Math.hypot(dx, dy, dz);
}

export function boxVolume(box: Bbox): number {
  return Math.max(0, box[3] - box[0]) * Math.max(0, box[4] - box[1]) * Math.max(0, box[5] - box[2]);
}

/**
 * 距离相差在这个范围内就算"一样近"，改比谁的包围盒小。
 *
 * 没有这一条，点胸口十有八九命中"脊柱"或"胸廓"这类横跨半个躯干的结构——
 * 它们的包围盒把胸口整个罩住，距离恒为 0，却什么也没说明。
 */
const TIE_MM = 12;

/**
 * 包围盒占全身体积超过这个比例的结构不参与——它们是"整个躯干""整套神经系统"
 * 这类容器，罩住一切、指不出任何地方。
 */
const MAX_BODY_FRACTION = 0.12;

export function probeBody(
  point: readonly [number, number, number],
  targets: readonly ProbeTarget[],
  bodyBox: Bbox,
  limit = 4,
): ProbeResult {
  const bodyVolume = boxVolume(bodyBox);
  const scored: { slug: string; region: Region; distance: number; volume: number }[] = [];
  for (const target of targets) {
    const volume = boxVolume(target.bbox);
    if (bodyVolume > 0 && volume / bodyVolume > MAX_BODY_FRACTION) continue;
    scored.push({
      slug: target.slug,
      region: target.region,
      distance: distanceToBox(point, target.bbox),
      volume,
    });
  }
  scored.sort((a, b) => {
    if (Math.abs(a.distance - b.distance) > TIE_MM) return a.distance - b.distance;
    return a.volume - b.volume;
  });
  const nearby = scored.slice(0, limit);
  return {
    region: nearby[0]?.region ?? null,
    nearby: nearby.map((entry) => entry.slug),
  };
}
