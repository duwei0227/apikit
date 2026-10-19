// 弹窗宽度的档位：按内容选择档位，不在各个弹窗里单独写数值（根字号为 14px）。
// 编辑器、日志、预览等需要尽量大的弹窗不用档位，按窗口比例设置并可最大化。

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'xxl';

/**
 * sm：单个字段、简短确认；md：名称加位置选择、选项列表；lg：多区块表单、列表；
 * xl：宽表单、较长的列表；xxl：表格、配置页
 */
export const DIALOG_WIDTHS: Record<DialogSize, string> = {
  sm: '30rem',
  md: '36rem',
  lg: '42rem',
  xl: '50rem',
  xxl: '60rem',
};

/** 弹窗的 style：固定宽度，窗口较小时不超出窗口 */
export function dialogStyle(size: DialogSize): { width: string; maxWidth: string } {
  return { width: DIALOG_WIDTHS[size], maxWidth: 'calc(100vw - 2rem)' };
}
