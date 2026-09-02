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
import Noir from './presets/Noir.js';

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
