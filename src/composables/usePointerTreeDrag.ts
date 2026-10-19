import { onMounted, onUnmounted, type Ref } from 'vue';
import { computeDropResult, findNodeByIndexPath, treeItemIndexPath, type DropPosition, type DropTreeNode } from '@/utils/treeDrop';

interface PointerDragState<N> {
  node: N;
  startX: number;
  startY: number;
  active: boolean;
  ghostEl: HTMLElement | null;
  lineEl: HTMLElement | null;
  targetKey: string | null;
  position: DropPosition;
}

export interface PointerTreeDragOptions<N> {
  /**
   * 拖到 target 上时放在哪里；offsetRatio 是指针在目标行中的纵向位置（0 为顶部，1 为底部）。
   * 返回 null 表示不能放在这里。
   */
  dropPosition: (dragNode: N, targetNode: N, offsetRatio: number) => DropPosition | null;
  /** 放下后的新树（与 Tree 组件 node-drop 事件的 value 相同） */
  onDrop: (newTree: N[], dragNode: N) => void | Promise<void>;
}

/**
 * 用指针事件模拟的树节点拖动（WebView2 不能可靠地支持 HTML5 拖放）。
 * enabled 为 false 时不做任何事，由 Tree 组件自带的拖放处理。
 */
export function usePointerTreeDrag<N extends DropTreeNode<N>>(
  treeNodes: Ref<N[]>,
  enabled: boolean,
  options: PointerTreeDragOptions<N>,
) {
  let ptrDrag: PointerDragState<N> | null = null;

  const onNodePointerDown = (node: N, event: PointerEvent) => {
    if (!enabled || event.button !== 0) return;
    ptrDrag = { node, startX: event.clientX, startY: event.clientY, active: false, ghostEl: null, lineEl: null, targetKey: null, position: 'after' };
  };

  const onGlobalPointerMove = (event: PointerEvent) => {
    if (!ptrDrag) return;
    if (!ptrDrag.active && Math.hypot(event.clientX - ptrDrag.startX, event.clientY - ptrDrag.startY) > 5) {
      ptrDrag.active = true;
      ptrDrag.ghostEl = document.createElement('div');
      Object.assign(ptrDrag.ghostEl.style, {
        position: 'fixed', zIndex: '9999', pointerEvents: 'none',
        background: 'var(--p-surface-100, #f1f5f9)', border: '1px solid var(--p-surface-300, #cbd5e1)',
        borderRadius: '4px', padding: '3px 10px', fontSize: '12px',
        whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', opacity: '0.9'
      });
      ptrDrag.ghostEl.textContent = ptrDrag.node.label;
      document.body.appendChild(ptrDrag.ghostEl);
      ptrDrag.lineEl = document.createElement('div');
      Object.assign(ptrDrag.lineEl.style, {
        position: 'fixed', height: '2px', zIndex: '9998', pointerEvents: 'none',
        background: 'var(--p-primary-500, #3b82f6)', display: 'none'
      });
      document.body.appendChild(ptrDrag.lineEl);
    }
    if (!ptrDrag.active) return;
    // 拖动开始后影子元素和指示线一定已创建
    const ghostEl = ptrDrag.ghostEl as HTMLElement;
    const lineEl = ptrDrag.lineEl as HTMLElement;
    event.preventDefault();
    ghostEl.style.left = `${event.clientX + 14}px`;
    ghostEl.style.top = `${event.clientY - 14}px`;

    ghostEl.style.visibility = 'hidden';
    const els = document.elementsFromPoint(event.clientX, event.clientY);
    ghostEl.style.visibility = '';

    const clearTarget = () => {
      if (!ptrDrag) return;
      ptrDrag.targetKey = null;
      lineEl.style.display = 'none';
    };

    const treeItemEl = els.find(el => el.getAttribute('role') === 'treeitem');
    if (!treeItemEl) { clearTarget(); return; }

    const targetNode = findNodeByIndexPath(treeNodes.value, treeItemIndexPath(treeItemEl));
    if (!targetNode || targetNode.key === ptrDrag.node.key) { clearTarget(); return; }

    const contentEl = treeItemEl.querySelector('.p-tree-node-content') || treeItemEl;
    const rect = contentEl.getBoundingClientRect();
    const offsetRatio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5;
    const dropPos = options.dropPosition(ptrDrag.node, targetNode, offsetRatio);
    if (!dropPos) { clearTarget(); return; }
    ptrDrag.targetKey = targetNode.key;
    ptrDrag.position = dropPos;
    if (dropPos === 'inside') {
      // Indented line at the bottom of the target row signals "will become a child"
      Object.assign(lineEl.style, { display: 'block', left: `${rect.left + 16}px`, width: `${rect.width - 16}px`, top: `${rect.bottom - 1}px` });
    } else {
      const lineY = dropPos === 'before' ? rect.top : rect.bottom;
      Object.assign(lineEl.style, { display: 'block', left: `${rect.left}px`, width: `${rect.width}px`, top: `${lineY - 1}px` });
    }
  };

  const onGlobalPointerUp = async () => {
    if (!ptrDrag) return;
    const { active, node, targetKey, position, ghostEl, lineEl } = ptrDrag;
    ptrDrag = null;
    ghostEl?.remove();
    lineEl?.remove();
    if (!active || !targetKey) return;
    const newTree = computeDropResult(treeNodes.value, node.key, targetKey, position);
    if (newTree) await options.onDrop(newTree, node);
  };

  /** 取消正在进行的指针拖动；有拖动被取消时返回 true */
  const cancelPointerDrag = () => {
    if (!ptrDrag?.active) return false;
    ptrDrag.ghostEl?.remove();
    ptrDrag.lineEl?.remove();
    ptrDrag = null;
    return true;
  };

  onMounted(() => {
    if (!enabled) return;
    window.addEventListener('pointermove', onGlobalPointerMove);
    window.addEventListener('pointerup', onGlobalPointerUp);
    window.addEventListener('pointercancel', onGlobalPointerUp);
  });

  onUnmounted(() => {
    if (!enabled) return;
    window.removeEventListener('pointermove', onGlobalPointerMove);
    window.removeEventListener('pointerup', onGlobalPointerUp);
    window.removeEventListener('pointercancel', onGlobalPointerUp);
  });

  return { onNodePointerDown, cancelPointerDrag };
}
