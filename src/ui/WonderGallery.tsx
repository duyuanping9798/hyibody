import { STRINGS } from './i18n';
import { WONDERS } from '../wonders';
import { estimatedSeconds, type Wonder } from '../wonders/engine';
import { SYSTEM_IDS, type SystemId } from '../data/types';
import { thumbUrl } from '../data/thumbs';
import { Gallery, type GalleryItem, type GalleryTab } from './Gallery';
import { useUiStore } from './store';

/**
 * 奥秘整页画廊。
 *
 * 取代了原来那个按系统分组的纯文字下拉：29 则内容挤在一个下拉里，
 * 既看不出讲的是什么，也不像一个"可以逛"的内容库。人类要的是图一那样
 * 的缩略图卡片墙——先看见画面，再看名字。
 */
function itemOf(w: Wonder, lang: 'zh' | 'en'): GalleryItem {
  const secs = Math.round(estimatedSeconds(w));
  return {
    id: w.id,
    title: w.title[lang],
    meta: `${secs}s`,
    system: (w.system ?? 'organs') as SystemId,
    thumb: thumbUrl('wonder', w.id),
  };
}

export function WonderGallery() {
  const lang = useUiStore((s) => s.lang);
  const t = STRINGS[lang];
  const gallery = useUiStore((s) => s.gallery);
  const closeGallery = useUiStore((s) => s.closeGallery);
  const startWonder = useUiStore((s) => s.startWonder);
  const openEditor = useUiStore((s) => s.openEditor);

  if (gallery !== 'wonders') return null;

  const tabs: GalleryTab[] = [
    { id: 'all', label: t.galleryAll, items: WONDERS.map((w) => itemOf(w, lang)) },
    ...SYSTEM_IDS.map((id) => ({
      id,
      label: t.systems[id],
      items: WONDERS.filter((w) => w.system === id).map((w) => itemOf(w, lang)),
    })),
  ];

  return (
    <Gallery
      testId="wonder-gallery"
      title={t.wondersTitle}
      tabs={tabs}
      closeLabel={t.galleryClose}
      emptyLabel={t.galleryEmpty}
      onClose={closeGallery}
      onPick={(id) => {
        const w = WONDERS.find((x) => x.id === id);
        if (w) startWonder(w);
      }}
      actions={
        <button
          className="hyi-btn hyi-btn-ghost"
          onClick={() => {
            closeGallery();
            openEditor();
          }}
        >
          {t.editor.open}
        </button>
      }
    />
  );
}
