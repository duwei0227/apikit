import { ref } from 'vue';

// 明暗主题：标题栏按钮和 Ctrl+Alt+D 快捷键共用同一个状态，
// 主题体现在 <html> 的 p-dark 类上，并保存到 localStorage。
const isDark = ref(false);

const apply = (dark: boolean) => {
  isDark.value = dark;
  document.documentElement.classList.toggle('p-dark', dark);
  localStorage.setItem('theme', dark ? 'dark' : 'light');
};

export function useTheme() {
  return {
    isDark,
    /** 按 localStorage 中保存的主题初始化 */
    restoreTheme: () => {
      isDark.value = localStorage.getItem('theme') === 'dark';
      document.documentElement.classList.toggle('p-dark', isDark.value);
    },
    toggleTheme: () => apply(!isDark.value),
  };
}
