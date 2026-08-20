import { describe, expect, it } from 'vitest';
import manifest from '../../public/assets/manifest.json';
import {
  boxVolume,
  distanceToBox,
  probeBody,
  type Bbox,
  type ProbeTarget,
} from '../../src/viewer/regions';
import type { Region } from '../../src/data/types';

const BODY = manifest.structures.skin!.bbox as unknown as Bbox;

/** 真实数据建目标表：排掉皮肤本身与 region: whole 的容器，跟查看器里一模一样。 */
const TARGETS: ProbeTarget[] = Object.entries(manifest.structures)
  .filter(([, info]) => info.system !== 'skin' && info.region !== 'whole' && info.bbox)
  .map(([slug, info]) => ({
    slug,
    region: info.region as Region,
    bbox: info.bbox as unknown as Bbox,
  }));

/** 某个结构包围盒的中心——拿它当"手指按在这块皮肤上"的近似位置。 */
function centerOf(slug: string): [number, number, number] {
  const b = manifest.structures[slug as keyof typeof manifest.structures]!.bbox as number[];
  return [(b[0]! + b[3]!) / 2, (b[1]! + b[4]!) / 2, (b[2]! + b[5]!) / 2];
}

describe('点到包围盒的距离', () => {
  const box: Bbox = [0, 0, 0, 10, 10, 10];

  it('盒内为 0', () => {
    expect(distanceToBox([5, 5, 5], box)).toBe(0);
    expect(distanceToBox([0, 0, 0], box)).toBe(0);
  });

  it('一个轴出界就是那一个轴的距离', () => {
    expect(distanceToBox([15, 5, 5], box)).toBe(5);
    expect(distanceToBox([5, -3, 5], box)).toBe(3);
  });

  it('三个轴都出界要算欧氏距离，不是各轴相加', () => {
    expect(distanceToBox([13, 14, 10], box)).toBeCloseTo(5, 6);
  });

  it('空盒（min === max）也不炸', () => {
    expect(boxVolume([1, 1, 1, 1, 1, 1])).toBe(0);
    expect(distanceToBox([1, 1, 4], [1, 1, 1, 1, 1, 1])).toBe(3);
  });
});

describe('皮肤反查：点在身上，告诉我这是哪儿', () => {
  it('数据本身够用：目标表非空，且身体包围盒有体积', () => {
    expect(TARGETS.length).toBeGreaterThan(150);
    expect(boxVolume(BODY)).toBeGreaterThan(0);
  });

  // 这几条是"用户点在哪儿 → 应该说这是哪儿"的真实抽样。
  // 位置取自真实结构的包围盒中心，所以这既在验证算法，也在验证数据。
  const CASES: [string, string, Region][] = [
    ['heart', '心脏那一片', 'thorax'],
    ['liver', '肝那一片', 'abdomen'],
    ['brain', '脑那一片', 'head'],
    ['femur_left', '大腿那一片', 'lower_limb'],
    ['humerus_left', '上臂那一片', 'upper_limb'],
  ];

  for (const [slug, label, region] of CASES) {
    it(`${label}反查出「${region}」`, () => {
      // 不做"数据里没有就跳过"：第一版写了这么一条兜底，结果 left_femur /
      // left_humerus 这两个 slug 根本不存在（真名是 femur_left），
      // 两条用例静悄悄地什么都没测。缺了就该红。
      expect(manifest.structures[slug as keyof typeof manifest.structures], slug).toBeTruthy();
      expect(probeBody(centerOf(slug), TARGETS, BODY).region).toBe(region);
    });
  }

  it('反查出的近邻按远近排，且不含皮肤自己', () => {
    const result = probeBody(centerOf('heart'), TARGETS, BODY);
    expect(result.nearby.length).toBeGreaterThan(0);
    expect(result.nearby).not.toContain('skin');
    for (const slug of result.nearby) {
      expect(manifest.structures[slug as keyof typeof manifest.structures]).toBeTruthy();
    }
  });

  it('近邻数量听 limit 的', () => {
    expect(probeBody(centerOf('heart'), TARGETS, BODY, 2).nearby).toHaveLength(2);
    expect(probeBody(centerOf('heart'), TARGETS, BODY, 6).nearby).toHaveLength(6);
  });

  it('罩住半个身子的结构不参与——否则点胸口只会告诉你"脊柱"', () => {
    const huge: ProbeTarget = {
      slug: 'everything',
      region: 'whole' as Region,
      bbox: BODY,
    };
    const result = probeBody(centerOf('heart'), [huge, ...TARGETS], BODY);
    expect(result.nearby).not.toContain('everything');
  });

  it('一样近的时候选小的那个：大盒子罩住一切，指不出任何地方', () => {
    const point: [number, number, number] = [0, 0, 0];
    const big: ProbeTarget = {
      slug: 'big',
      region: 'thorax' as Region,
      bbox: [-50, -50, -50, 50, 50, 50],
    };
    const small: ProbeTarget = {
      slug: 'small',
      region: 'abdomen' as Region,
      bbox: [-5, -5, -5, 5, 5, 5],
    };
    // 两个都套住这个点，距离都是 0
    const result = probeBody(point, [big, small], [-100, -100, -100, 100, 100, 100], 2);
    expect(result.nearby[0]).toBe('small');
    expect(result.region).toBe('abdomen');
  });

  it('目标表空了就如实返回 null，而不是瞎猜一个部位', () => {
    expect(probeBody([0, 0, 0], [], BODY)).toEqual({ region: null, nearby: [] });
  });
});
