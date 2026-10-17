// ApiKit 文档站：中文在根路径，英文在 /en/。发布到 GitHub Pages（https://duwei0227.github.io/apikit/）。
import { defineConfig, type DefaultTheme } from 'vitepress';

const repo = 'https://github.com/duwei0227/apikit';

const zhSidebar: DefaultTheme.Sidebar = [
  {
    text: '入门',
    items: [{ text: '快速开始', link: '/guide/getting-started' }],
  },
  {
    text: '请求',
    items: [
      { text: '发送请求', link: '/guide/requests' },
      { text: '测试与断言', link: '/guide/tests' },
      { text: '响应', link: '/guide/responses' },
      { text: '变量', link: '/guide/variables' },
    ],
  },
  {
    text: '组织',
    items: [
      { text: '集合', link: '/guide/collections' },
      { text: '导入导出', link: '/guide/import-export' },
      { text: 'Console 和历史', link: '/guide/console-history' },
    ],
  },
  {
    text: '自动化',
    items: [
      { text: '工作流（Workflow）', link: '/guide/workflow' },
      { text: 'Mock 服务', link: '/guide/mock' },
      { text: 'AI 集成（MCP）', link: '/guide/ai' },
    ],
  },
  {
    text: '参考',
    items: [{ text: '快捷键、数据和常见问题', link: '/guide/reference' }],
  },
];

const enSidebar: DefaultTheme.Sidebar = [
  {
    text: 'Introduction',
    items: [{ text: 'Getting Started', link: '/en/guide/getting-started' }],
  },
  {
    text: 'Requests',
    items: [
      { text: 'Sending Requests', link: '/en/guide/requests' },
      { text: 'Tests and Assertions', link: '/en/guide/tests' },
      { text: 'Responses', link: '/en/guide/responses' },
      { text: 'Variables', link: '/en/guide/variables' },
    ],
  },
  {
    text: 'Organize',
    items: [
      { text: 'Collections', link: '/en/guide/collections' },
      { text: 'Import and Export', link: '/en/guide/import-export' },
      { text: 'Console and History', link: '/en/guide/console-history' },
    ],
  },
  {
    text: 'Automate',
    items: [
      { text: 'Workflows', link: '/en/guide/workflow' },
      { text: 'Mock Services', link: '/en/guide/mock' },
      { text: 'AI Integration (MCP)', link: '/en/guide/ai' },
    ],
  },
  {
    text: 'Reference',
    items: [{ text: 'Shortcuts, Data and FAQ', link: '/en/guide/reference' }],
  },
];

export default defineConfig({
  title: 'ApiKit',
  base: '/apikit/',
  cleanUrls: true,
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/apikit/logo.svg' }]],
  markdown: {
    config(md) {
      // 文档中大量出现 {{变量}}：行内代码加 v-pre，原样显示而不是被 Vue 当作插值（代码块默认已加）
      const renderInlineCode = md.renderer.rules.code_inline!;
      md.renderer.rules.code_inline = (...args) => renderInlineCode(...args).replace(/^<code/, '<code v-pre');
    },
  },
  themeConfig: {
    logo: '/logo.svg',
    socialLinks: [{ icon: 'github', link: repo }],
    search: {
      provider: 'local',
      options: {
        locales: {
          root: {
            translations: {
              button: { buttonText: '搜索', buttonAriaLabel: '搜索' },
              modal: {
                noResultsText: '没有找到结果',
                resetButtonTitle: '清除',
                footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
              },
            },
          },
        },
      },
    },
  },
  locales: {
    root: {
      label: '中文',
      lang: 'zh-CN',
      description: '现代化、轻量级的 API 测试工具',
      themeConfig: {
        nav: [
          { text: '指南', link: '/guide/getting-started' },
          { text: '下载', link: `${repo}/releases/latest` },
          { text: '更新日志', link: `${repo}/blob/main/CHANGELOG.md` },
        ],
        sidebar: zhSidebar,
        editLink: { pattern: `${repo}/edit/main/docs/:path`, text: '在 GitHub 上编辑此页' },
        outline: { label: '本页目录', level: [2, 3] },
        docFooter: { prev: '上一页', next: '下一页' },
        returnToTopLabel: '回到顶部',
        sidebarMenuLabel: '菜单',
        darkModeSwitchLabel: '主题',
        langMenuLabel: '语言',
      },
    },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      description: 'A modern, lightweight API testing tool',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/en/guide/getting-started' },
          { text: 'Download', link: `${repo}/releases/latest` },
          { text: 'Changelog', link: `${repo}/blob/main/CHANGELOG.md` },
        ],
        sidebar: enSidebar,
        editLink: { pattern: `${repo}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
        outline: { level: [2, 3] },
      },
    },
  },
});
