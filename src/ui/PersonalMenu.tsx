import { STRINGS } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { ShareIcon, UserIcon } from './Icon';
import { useUiStore } from './store';

/**
 * 个人中心（2026-08-22 顶栏收拢）：分享与创作从顶栏的两个独立按钮收进
 * 同一个 👤 图标下的小菜单。播放奥秘时创作入口藏起来（和原来的
 * EditorButton 一致——播放中开编辑器会互相踩状态）。
 */
export function PersonalMenu({ onShare }: { onShare(): void }) {
  const t = STRINGS[useUiStore((s) => s.lang)];
  const [open, setOpen] = useState(false);
  const openEditor = useUiStore((s) => s.openEditor);
  const wonder = useUiStore((s) => s.wonder);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Esc 关菜单。菜单的 open 是组件局部状态，keyboard.ts 的全局 Esc 优先级链
  // 不知道它——不拦的话按 Esc 菜单原样开着、背后的选中反被清掉（审查逮到的）。
  // 用捕获阶段抢在全局快捷键之前，关掉后把焦点还给触发按钮。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  return (
    <div className="hyi-personal">
      <button
        ref={triggerRef}
        className="hyi-btn hyi-btn-icon"
        aria-label={t.personalTitle}
        title={t.personalTitle}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
      >
        <UserIcon />
      </button>
      {open && (
        <>
          {/* 透明背板：点菜单外任何地方都收起，不用全局监听 */}
          <div className="hyi-popover-backdrop" onClick={() => setOpen(false)} />
          <div className="hyi-popover" role="menu" data-testid="personal-menu">
            <button
              role="menuitem"
              autoFocus
              onClick={() => {
                setOpen(false);
                onShare();
              }}
            >
              <ShareIcon />
              <span>{t.shareTitle}</span>
            </button>
            {!wonder && (
              <button
                role="menuitem"
                data-testid="editor-open"
                onClick={() => {
                  setOpen(false);
                  openEditor();
                }}
              >
                <span className="hyi-popover-glyph" aria-hidden>
                  ✎
                </span>
                <span>{t.editor.open}</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
