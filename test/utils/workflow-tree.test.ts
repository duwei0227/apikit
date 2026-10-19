import { describe, expect, it } from 'vitest';
import type { WorkflowLayout } from '@/types/models';
import { computeDropResult } from '@/utils/treeDrop';
import {
  addFolderToLayout,
  addWorkflowToLayout,
  buildWorkflowFolderTree,
  buildWorkflowTree,
  ensureWorkflowFolderPath,
  findParentFolderId,
  insertWorkflowAfter,
  isWorkflowFolderNameTaken,
  layoutFromTree,
  listWorkflowPlacements,
  moveWorkflowInLayout,
  normalizeWorkflowLayout,
  readWorkflowFolderPath,
  removeFolderFromLayout,
  removeWorkflowFromLayout,
  renameFolderInLayout,
} from '@/utils/workflowTree';

const workflows = [
  { id: 'w1', name: 'Login' },
  { id: 'w2', name: 'Checkout' },
  { id: 'w3', name: 'Refund' },
];

/** 根目录：文件夹 Orders（Checkout、子文件夹 After sales（Refund））和 Login */
const layout: WorkflowLayout = {
  items: [
    {
      type: 'folder', id: 'f1', name: 'Orders', children: [
        { type: 'workflow', id: 'w2' },
        { type: 'folder', id: 'f2', name: 'After sales', children: [{ type: 'workflow', id: 'w3' }] },
      ],
    },
    { type: 'workflow', id: 'w1' },
  ],
};

const labels = (nodes: ReturnType<typeof buildWorkflowTree>): unknown[] => nodes.map(node => (
  node.children.length > 0 ? [node.label, labels(node.children)] : node.label
));

describe('normalizeWorkflowLayout', () => {
  it('没有保存过结构时按原顺序把全部 Workflow 放在根目录', () => {
    expect(normalizeWorkflowLayout(null, ['w1', 'w2'])).toEqual({
      items: [{ type: 'workflow', id: 'w1' }, { type: 'workflow', id: 'w2' }],
    });
  });

  it('去掉不存在、重复和无效的条目，缺少的 Workflow 放到根目录末尾', () => {
    const raw = {
      items: [
        { type: 'workflow', id: 'gone' },
        { type: 'folder', id: 'f1', name: 'Orders', children: [{ type: 'workflow', id: 'w2' }, { type: 'workflow', id: 'w2' }] },
        { type: 'folder', id: 'f1', name: 'Duplicate folder', children: [] },
        { type: 'folder', id: 'f3' },
        'not an item',
      ],
    };
    expect(normalizeWorkflowLayout(raw, ['w1', 'w2', 'w3'])).toEqual({
      items: [
        { type: 'folder', id: 'f1', name: 'Orders', children: [{ type: 'workflow', id: 'w2' }] },
        { type: 'workflow', id: 'w1' },
        { type: 'workflow', id: 'w3' },
      ],
    });
  });
});

describe('buildWorkflowTree', () => {
  it('按结构生成带层级 key 的节点，Workflow 节点不能放入子节点', () => {
    const tree = buildWorkflowTree(layout, workflows);
    expect(labels(tree)).toEqual([['Orders', ['Checkout', ['After sales', ['Refund']]]], 'Login']);
    expect(tree[0].children[1].children[0].key).toBe('folder:f1/folder:f2/workflow:w3');
    expect(tree[1]).toMatchObject({ droppable: false, data: { type: 'workflow', id: 'w1', name: 'Login' } });
    expect(tree[0].droppable).toBeUndefined();
  });

  it('搜索时保留匹配的 Workflow 和它的上级；匹配的文件夹保留全部内容', () => {
    expect(labels(buildWorkflowTree(layout, workflows, 'refund'))).toEqual([['Orders', [['After sales', ['Refund']]]]]);
    expect(labels(buildWorkflowTree(layout, workflows, 'after'))).toEqual([['Orders', [['After sales', ['Refund']]]]]);
    expect(buildWorkflowTree(layout, workflows, 'nothing')).toEqual([]);
  });

  it('拖放后的节点转回相同结构', () => {
    const tree = buildWorkflowTree(layout, workflows);
    expect(layoutFromTree(tree)).toEqual(layout);

    // Login 拖进 After sales，Checkout 拖到根目录最前面
    const moved = computeDropResult(tree, 'workflow:w1', 'folder:f1/folder:f2', 'inside')!;
    const reordered = computeDropResult(moved, 'folder:f1/workflow:w2', 'folder:f1', 'before')!;
    expect(listWorkflowPlacements(layoutFromTree(reordered))).toEqual([
      { id: 'w2', folderPath: [] },
      { id: 'w3', folderPath: ['Orders', 'After sales'] },
      { id: 'w1', folderPath: ['Orders', 'After sales'] },
    ]);
    // 文件夹不能放进自己的子文件夹
    expect(computeDropResult(tree, 'folder:f1', 'folder:f1/folder:f2', 'inside')).toBeNull();
  });
});

describe('修改结构', () => {
  it('添加、移动和删除 Workflow，不改动原结构', () => {
    const added = addWorkflowToLayout(layout, 'w4', 'f2');
    expect(listWorkflowPlacements(added).at(-2)).toEqual({ id: 'w4', folderPath: ['Orders', 'After sales'] });
    expect(listWorkflowPlacements(layout)).toHaveLength(3);

    const moved = addWorkflowToLayout(layout, 'w3', null);
    expect(listWorkflowPlacements(moved)).toEqual([
      { id: 'w2', folderPath: ['Orders'] },
      { id: 'w1', folderPath: [] },
      { id: 'w3', folderPath: [] },
    ]);

    // 文件夹不存在时放到根目录
    expect(listWorkflowPlacements(addWorkflowToLayout(layout, 'w4', 'missing')).at(-1)).toEqual({ id: 'w4', folderPath: [] });

    expect(listWorkflowPlacements(removeWorkflowFromLayout(layout, 'w3')).map(item => item.id)).toEqual(['w2', 'w1']);

    // 复制出的 Workflow 放在原 Workflow 后面（同一文件夹）
    expect(listWorkflowPlacements(insertWorkflowAfter(layout, 'w4', 'w2')).slice(0, 2)).toEqual([
      { id: 'w2', folderPath: ['Orders'] },
      { id: 'w4', folderPath: ['Orders'] },
    ]);
    expect(listWorkflowPlacements(insertWorkflowAfter(layout, 'w4', 'missing')).at(-1)).toEqual({ id: 'w4', folderPath: [] });
  });

  it('Workflow 与同一文件夹中相邻的条目交换位置，到头时不变', () => {
    const shape = (value: WorkflowLayout) => value.items.map(item => (item.id));

    expect(shape(moveWorkflowInLayout(layout, 'w1', 'up'))).toEqual(['w1', 'f1']);
    expect(shape(moveWorkflowInLayout(layout, 'w1', 'down'))).toEqual(['f1', 'w1']);
    expect(shape(moveWorkflowInLayout(layout, 'missing', 'up'))).toEqual(['f1', 'w1']);
    expect(shape(layout)).toEqual(['f1', 'w1']);

    // 文件夹中：和相邻的子文件夹交换
    const down = moveWorkflowInLayout(layout, 'w2', 'down');
    expect(listWorkflowPlacements(down).map(item => item.id)).toEqual(['w3', 'w2', 'w1']);
    expect(listWorkflowPlacements(moveWorkflowInLayout(layout, 'w2', 'up'))).toEqual(listWorkflowPlacements(layout));
    expect(listWorkflowPlacements(moveWorkflowInLayout(layout, 'w3', 'down'))).toEqual(listWorkflowPlacements(layout));
  });

  it('只含文件夹的树用于选择移动目标', () => {
    const folders = buildWorkflowFolderTree(layout.items);
    expect(folders.map(node => [node.key, node.label, node.children.map(child => child.key)])).toEqual([
      ['f1', 'Orders', ['f2']],
    ]);
  });

  it('新建、重命名和删除文件夹，删除时返回其中的全部 Workflow', () => {
    const created = addFolderToLayout(layout, { id: 'f9', name: 'Smoke' }, 'f1');
    expect(findParentFolderId(created, 'f9')).toBe('f1');
    expect(findParentFolderId(created, 'f1')).toBeNull();
    expect(findParentFolderId(created, 'missing')).toBeUndefined();

    const renamed = renameFolderInLayout(created, 'f2', 'Returns');
    expect(listWorkflowPlacements(renamed).find(item => item.id === 'w3')?.folderPath).toEqual(['Orders', 'Returns']);

    const { layout: rest, workflowIds } = removeFolderFromLayout(layout, 'f1');
    expect(workflowIds).toEqual(['w2', 'w3']);
    expect(rest.items).toEqual([{ type: 'workflow', id: 'w1' }]);
  });

  it('同一位置的文件夹名称不能重复（不区分大小写）', () => {
    expect(isWorkflowFolderNameTaken(layout, null, 'orders')).toBe(true);
    expect(isWorkflowFolderNameTaken(layout, null, 'After sales')).toBe(false);
    expect(isWorkflowFolderNameTaken(layout, 'f1', ' AFTER SALES ')).toBe(true);
    expect(isWorkflowFolderNameTaken(layout, 'f1', 'After sales', 'f2')).toBe(false);
  });

  it('按名称路径找到或逐级新建文件夹', () => {
    let next = 0;
    const createId = () => `new-${++next}`;

    expect(ensureWorkflowFolderPath(layout, [], createId).folderId).toBeNull();

    const existing = ensureWorkflowFolderPath(layout, ['orders', 'AFTER SALES'], createId);
    expect(existing.folderId).toBe('f2');
    expect(existing.layout).toEqual(layout);

    const created = ensureWorkflowFolderPath(layout, ['Orders', 'Archive', '2026'], createId);
    expect(created.folderId).toBe('new-2');
    expect(findParentFolderId(created.layout, 'new-2')).toBe('new-1');
    expect(findParentFolderId(created.layout, 'new-1')).toBe('f1');
  });

  it('导入文件中的 folderPath 只保留非空字符串', () => {
    expect(readWorkflowFolderPath(['Orders', ' ', 3, ' After sales '])).toEqual(['Orders', 'After sales']);
    expect(readWorkflowFolderPath('Orders')).toEqual([]);
    expect(readWorkflowFolderPath(undefined)).toEqual([]);
  });
});
