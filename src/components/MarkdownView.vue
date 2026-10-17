<script setup lang="ts">
import { computed, getCurrentInstance, h, onBeforeUnmount, ref, render, watch } from 'vue';
import DOMPurify from 'dompurify';
import { openUrl } from '@tauri-apps/plugin-opener';
import { renderMarkdown } from '@/utils/answerRender';
import HtmlPreview from './HtmlPreview.vue';

// 渲染大模型回答里的 Markdown。内容来自任意服务端：先转义再清洗，链接交给系统浏览器打开。
const props = withDefaults(defineProps<{
  source?: string;
  allowScripts?: boolean;
}>(), {
  source: '',
  allowScripts: false,
});

const container = ref<HTMLElement | null>(null);
const appContext = getCurrentInstance()!.appContext;

const html = computed(() => DOMPurify.sanitize(renderMarkdown(props.source), {
  ADD_ATTR: ['data-action', 'data-lang'],
  FORBID_TAGS: ['style', 'form', 'input', 'textarea', 'select', 'iframe', 'object', 'embed', 'img', 'video', 'audio'],
  FORBID_ATTR: ['style', 'srcset'],
}));

// 代码块里打开的 HTML 预览，内容重新渲染时要卸载
let previews: HTMLElement[] = [];
const clearPreviews = () => {
  previews.forEach(mount => render(null, mount));
  previews = [];
};
watch(html, clearPreviews, { flush: 'pre' });
onBeforeUnmount(clearPreviews);

const copyCode = async (block: HTMLElement, button: HTMLElement) => {
  try {
    await navigator.clipboard.writeText(block.querySelector('code')?.textContent ?? '');
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = 'Copy'; }, 1500);
  } catch {
    window.$toast?.add({ severity: 'error', summary: 'Error', detail: 'Failed to copy to clipboard', life: 3000 });
  }
};

const togglePreview = (block: HTMLElement, button: HTMLElement) => {
  const existing = block.querySelector<HTMLElement>('.md-code-preview');
  if (existing) {
    render(null, existing);
    previews = previews.filter(mount => mount !== existing);
    existing.remove();
    button.textContent = 'Preview';
    return;
  }
  const mount = document.createElement('div');
  mount.className = 'md-code-preview';
  block.appendChild(mount);
  const code = block.querySelector('code')?.textContent ?? '';
  // 沿用应用的上下文，预览里的 PrimeVue 组件才能正常工作
  const vnode = h(HtmlPreview, { html: code, allowScripts: props.allowScripts, height: 260 });
  vnode.appContext = appContext;
  render(vnode, mount);
  previews.push(mount);
  button.textContent = 'Hide preview';
};

const onClick = (event: MouseEvent) => {
  const target = (event.target as Element).closest<HTMLElement>('[data-action]');
  if (!target || !container.value?.contains(target)) return;
  const action = target.dataset.action;
  if (action === 'link') {
    // 不在 ApiKit 的窗口里跳转
    event.preventDefault();
    const href = target.getAttribute('href');
    if (href) openUrl(href).catch(error => console.error('Failed to open link:', error));
    return;
  }
  const block = target.closest<HTMLElement>('.md-code');
  if (!block) return;
  if (action === 'copy') copyCode(block, target);
  else if (action === 'preview') togglePreview(block, target);
};
</script>

<template>
  <div ref="container" class="md-view" @click="onClick" v-html="html"></div>
</template>

<style>
.md-view {
  font-size: 0.875rem;
  line-height: 1.7;
  word-break: break-word;
}
.md-view > :first-child { margin-top: 0; }
.md-view > :last-child { margin-bottom: 0; }
.md-view h1, .md-view h2, .md-view h3, .md-view h4, .md-view h5, .md-view h6 {
  margin: 1.1em 0 0.5em;
  font-weight: 600;
  line-height: 1.35;
}
.md-view h1 { font-size: 1.4rem; }
.md-view h2 { font-size: 1.2rem; }
.md-view h3 { font-size: 1.05rem; }
.md-view h4, .md-view h5, .md-view h6 { font-size: 0.95rem; }
.md-view p { margin: 0 0 0.75em; }
.md-view ul, .md-view ol { margin: 0 0 0.75em; padding-left: 1.5em; }
.md-view ul { list-style: disc; }
.md-view ol { list-style: decimal; }
.md-view li > ul, .md-view li > ol { margin-bottom: 0; }
.md-view a { color: var(--p-primary-color); text-decoration: underline; cursor: pointer; }
.md-view blockquote {
  margin: 0 0 0.75em;
  padding: 0.1em 0.9em;
  border-left: 3px solid var(--p-content-border-color);
  color: var(--p-text-muted-color);
}
.md-view hr { margin: 1em 0; border: 0; border-top: 1px solid var(--p-content-border-color); }
.md-view code {
  font-family: 'JetBrains Mono Variable', ui-monospace, monospace;
  font-size: 0.8rem;
}
.md-view :not(pre) > code {
  padding: 0.1em 0.35em;
  border-radius: 4px;
  background: var(--p-content-hover-background);
}
.md-view table {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  margin: 0 0 0.75em;
  border-collapse: collapse;
  font-size: 0.8125rem;
}
.md-view th, .md-view td {
  padding: 0.35em 0.75em;
  border: 1px solid var(--p-content-border-color);
  text-align: left;
}
.md-view th { background: var(--p-content-hover-background); font-weight: 600; }
.md-view .md-code {
  margin: 0 0 0.75em;
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  overflow: hidden;
}
.md-view .md-code-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.15rem 0.6rem;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  background: var(--p-content-hover-background);
}
.md-view .md-code-actions { display: flex; gap: 0.25rem; }
.md-view .md-code-button {
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  font-size: 0.75rem;
  color: inherit;
  cursor: pointer;
}
.md-view .md-code-button:hover { background: var(--p-content-border-color); }
.md-view .md-code pre {
  margin: 0;
  padding: 0.6rem 0.75rem;
  overflow-x: auto;
  line-height: 1.6;
}
.md-view .md-code-preview { padding: 0.6rem 0.75rem; border-top: 1px solid var(--p-content-border-color); }
.md-view .md-image-link::before { content: '[image] '; }
</style>
