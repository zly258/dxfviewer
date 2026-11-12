/**
 * 极简预览入口（`@zhangly1403/dxfviewer/preview`）。
 *
 * 只导出单文件预览组件与随附类型，不引入完整查看器的工具栏 / 面板 / 工作区，
 * 便于第三方库按需接入。
 *
 * 样式：与主入口共用 `@zhangly1403/dxfviewer/style.css`（已含预览组件样式），
 * 也可单独引入 `src/ui/styles/preview.css`（自包含，不依赖完整查看器令牌）。
 * 本入口不自带 CSS，避免多入口各自产出样式文件导致资源名冲突。
 */
export { default as DxfPreview } from '@/ui/components/preview/DxfPreview';
export type { DxfPreviewProps, DxfPreviewHandle, DxfPreviewSource } from '@/ui/components/preview/DxfPreview';

export { parseDxf } from '@/io/parser';
export type { DxfData, ViewPort } from '@/types';
export { setOutlineFont, loadOutlineFont, hasOutlineFont, hasOutlineFontCjkCoverage } from '@/render/text/outlineText';
