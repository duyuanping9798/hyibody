/** 系统分层 ID，顺序即分层滑块的由外到内顺序（KICKOFF 第 6 节）。 */
export const SYSTEM_IDS = ['skin', 'muscles', 'skeleton', 'organs', 'vessels', 'nerves'] as const;
export type SystemId = (typeof SYSTEM_IDS)[number];

export type Region =
  'head' | 'neck' | 'thorax' | 'abdomen' | 'pelvis' | 'upper_limb' | 'lower_limb' | 'whole';

export type Side = 'left' | 'right' | 'none' | 'both';

export type DataSource = 'bp3d' | 'bp3d_partof' | 'hra' | 'cc0' | 'placeholder';

/** manifest.json 中单个结构的元数据（KICKOFF 第 7 节）。 */
export interface StructureInfo {
  zh: string;
  en: string;
  system: SystemId | 'placeholder';
  region: Region;
  side: Side;
  fma: string[];
  source: DataSource;
  /** [minX, minY, minZ, maxX, maxY, maxZ]，单位毫米 */
  bbox?: [number, number, number, number, number, number];
}

export interface SystemBundle {
  id: SystemId | 'placeholder';
  file: string;
  bytes: number;
  structures: string[];
}

export interface Manifest {
  version: string;
  generatedAt: string;
  systems: SystemBundle[];
  structures: Record<string, StructureInfo>;
  attribution: string[];
}
