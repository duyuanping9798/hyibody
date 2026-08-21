import { STRINGS } from './i18n';
import { ATLAS_VIEWS, REGION_ORDER, type AtlasView } from '../data/views';
import { thumbUrl } from '../data/thumbs';
import { Gallery, type GalleryItem, type GalleryTab } from './Gallery';
import { useUiStore } from './store';

/**
 * 局部细剖视图库（人类给的图二）。
 *
 * 每张卡片是一个策展好的画面：机位、分层、显隐、展开、剖切一次到位。
 * 和奥秘的区别是**它不播**——点一下就把画面摆成那样，然后把画廊关掉，
 * 人就站在那个视角上，可以接着自己转、自己点。
 */
function itemOf(v: AtlasView, lang: 'zh' | 'en', regionLabel: string): GalleryItem {
  return {
    id: v.id,
    title: v.title[lang],
    meta: regionLabel,
    system: v.system,
    thumb: thumbUrl('view', v.id),
    badge: '3D',
  };
}

export function AtlasGallery() {
  const lang = useUiStore((s) => s.lang);
  const t = STRINGS[lang];
  const gallery = useUiStore((s) => s.gallery);
  const closeGallery = useUiStore((s) => s.closeGallery);
  const applyAtlasView = useUiStore((s) => s.applyAtlasView);

  if (gallery !== 'atlas') return null;

  const label = (v: AtlasView) => t.regions[v.region];
  const tabs: GalleryTab[] = [
    {
      id: 'all',
      label: t.galleryAll,
      items: ATLAS_VIEWS.map((v) => itemOf(v, lang, label(v))),
    },
    ...REGION_ORDER.map((region) => ({
      id: region,
      label: t.regions[region],
      items: ATLAS_VIEWS.filter((v) => v.region === region).map((v) => itemOf(v, lang, label(v))),
    })),
  ];

  return (
    <Gallery
      testId="atlas-gallery"
      title={t.atlasTitle}
      tabs={tabs}
      closeLabel={t.galleryClose}
      emptyLabel={t.galleryEmpty}
      onClose={closeGallery}
      onPick={(id) => {
        const v = ATLAS_VIEWS.find((x) => x.id === id);
        if (v) applyAtlasView(v);
      }}
    />
  );
}
