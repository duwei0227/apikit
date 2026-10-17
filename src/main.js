// 入口保持 JavaScript：改为 .ts 后类型检查会启用 PrimeVue 全局组件的类型，
// 模板中仍在使用的旧版 TabView/TabPanel 写法（header 属性）会报错，需先迁移到新的 Tabs 组件。
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "primeicons/primeicons.css";
import "./style.css";

import { createApp } from "vue";
import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import ToastService from "primevue/toastservice";
import ConfirmationService from 'primevue/confirmationservice';

import App from "./App.vue";
import Noir from './presets/Noir';

const pinia = createPinia();
const app = createApp(App);

app.use(pinia);
app.use(PrimeVue, {
    theme: {
        preset: Noir,
        options: {
            prefix: 'p',
            darkModeSelector: '.p-dark',
            cssLayer: false,
        }
    }
});

app.use(ToastService);
app.use(ConfirmationService);

app.mount("#app");
performance.mark('vue-mounted');
