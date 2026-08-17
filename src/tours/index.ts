import digestion from '../../content/tours/digestion.json';
import heartbeat from '../../content/tours/heartbeat.json';
import nerve from '../../content/tours/nerve.json';
import type { Tour } from './engine';

/** 内置三条故事线（KICKOFF M2-1）；JSON 的合法性由 tests/unit/tours.test.ts 保证。 */
export const TOURS = [heartbeat, digestion, nerve] as unknown as Tour[];
