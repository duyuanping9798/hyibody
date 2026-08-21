import type { WonderStep } from '../wonders/engine';
import type { Region, SystemId } from './types';

/**
 * 局部细剖视图：一个策展好的"看这里、这么看"的画面。
 *
 * 它复用 `WonderStep` 的字段（layer / selected / from / systems / expand / clip），
 * 因为**细剖视图本质上就是一步没有文字的奥秘**——画面怎么摆这件事，
 * 奥秘引擎已经解决过一次了，没有理由再写第二套。少的只是 text 与 durationMs。
 */
export type AtlasScene = Omit<WonderStep, 'text' | 'durationMs'>;

export interface AtlasView {
  schema: 1;
  id: string;
  title: { zh: string; en: string };
  region: Region;
  /** 这条视图主要在讲哪一层——决定卡片的颜色标与分类标签 */
  system: SystemId;
  view: AtlasScene;
}

const MODULES = import.meta.glob('../../content/views/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, AtlasView>;

/** 稳定顺序：按文件名排，避免打包器的遍历顺序影响卡片排列。 */
export const ATLAS_VIEWS: AtlasView[] = Object.keys(MODULES)
  .sort()
  .map((k) => MODULES[k]!);

/** 部位分组的展示顺序：由上到下、由中轴到四肢，和人看解剖图的习惯一致。 */
export const REGION_ORDER: readonly Region[] = [
  'head',
  'neck',
  'thorax',
  'abdomen',
  'pelvis',
  'whole',
  'upper_limb',
  'lower_limb',
];

/** 按部位分组，只保留有内容的部位。 */
export function viewsByRegion(
  views: readonly AtlasView[] = ATLAS_VIEWS,
): { region: Region; items: AtlasView[] }[] {
  return REGION_ORDER.map((region) => ({
    region,
    items: views.filter((v) => v.region === region),
  })).filter((g) => g.items.length > 0);
}
