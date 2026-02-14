/**
 * 菜单协调 Hook
 * 
 * 解决多个独立菜单（AddButtonEdge popover、ClipNode 右键菜单、画布右键菜单）
 * 同时打开的问题。当任何菜单打开时，广播自定义事件关闭其他所有菜单。
 * 
 * 用法：
 *   const { broadcastCloseMenus } = useMenuCoordination(closeMyMenu);
 *   // 打开菜单时：先 broadcastCloseMenus()，再 setMyMenu(...)
 */

import { useEffect, useCallback, useRef } from 'react';

const CLOSE_ALL_MENUS_EVENT = 'workflow-close-all-menus';

/**
 * @param onClose 当收到关闭事件时调用（关闭自己的菜单）
 * @returns broadcastCloseMenus — 在打开自己菜单前调用，通知其他菜单关闭
 */
export function useMenuCoordination(onClose: () => void) {
  // 用 ref 避免 effect 重建
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 标记：广播后短暂忽略自己发出的事件
  const ignoreNextRef = useRef(false);

  useEffect(() => {
    const handler = () => {
      if (ignoreNextRef.current) {
        ignoreNextRef.current = false;
        return;
      }
      onCloseRef.current();
    };
    window.addEventListener(CLOSE_ALL_MENUS_EVENT, handler);
    return () => window.removeEventListener(CLOSE_ALL_MENUS_EVENT, handler);
  }, []);

  const broadcastCloseMenus = useCallback(() => {
    ignoreNextRef.current = true;
    window.dispatchEvent(new CustomEvent(CLOSE_ALL_MENUS_EVENT));
  }, []);

  return { broadcastCloseMenus };
}
