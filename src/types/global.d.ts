// 在 App.vue 中挂到 window 上的 PrimeVue 服务，供不在组件树中的代码弹出提示和确认框
import type { useConfirm } from 'primevue/useconfirm';
import type { useToast } from 'primevue/usetoast';

declare global {
  interface Window {
    $toast?: ReturnType<typeof useToast>;
    $confirm?: ReturnType<typeof useConfirm>;
  }
}

export {};
