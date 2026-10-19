// 新建文件夹在同层中的位置：紧跟最后一个文件夹，即其他文件夹之后、request / workflow 之前；
// 同层被拖成交错顺序时仍紧跟最后一个文件夹，不改变已有项的顺序。

/** 按显示顺序给出同层各项是否为文件夹，返回新文件夹应插入的下标 */
export function newFolderIndex(isFolder: boolean[]): number {
  return isFolder.lastIndexOf(true) + 1;
}
