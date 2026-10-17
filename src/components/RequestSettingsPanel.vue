<script setup lang="ts">
// 请求设置：重定向、SSL 校验、URL 编码和压缩
const followRedirects = defineModel('followRedirects', { type: Boolean, required: true });
const maxRedirectCount = defineModel('maxRedirectCount', { type: Number, required: true });
const verifySsl = defineModel('verifySsl', { type: Boolean, required: true });
const autoEncodeUrl = defineModel('autoEncodeUrl', { type: Boolean, required: true });
const acceptEncoding = defineModel('acceptEncoding', { type: Boolean, required: true });
</script>

<template>
  <div class="p-4 overflow-y-auto">
    <div class="space-y-4">
      <div class="flex items-center justify-between py-2">
        <div>
          <div class="text-sm font-medium text-surface-700 dark:text-surface-300">Automatically follow redirects</div>
          <div class="text-xs text-surface-500 dark:text-surface-400 mt-1">When enabled, HTTP redirects (3xx) will be followed automatically</div>
        </div>
        <div class="flex items-center gap-2">
          <ToggleSwitch v-model="followRedirects" />
          <span class="text-xs font-medium" :class="followRedirects ? 'text-green-600 dark:text-green-400' : 'text-surface-400'">{{ followRedirects ? 'ON' : 'OFF' }}</span>
        </div>
      </div>
      <div class="flex items-center justify-between py-2">
        <div>
          <div class="text-sm font-medium text-surface-700 dark:text-surface-300">Max redirects</div>
          <div class="text-xs text-surface-500 dark:text-surface-400 mt-1">Maximum number of redirects to follow (1-50)</div>
        </div>
        <InputNumber v-model="maxRedirectCount" :min="1" :max="50" :step="1" showButtons class="w-24" size="small" inputClass="w-12 text-center" />
      </div>
      <div class="flex items-center justify-between py-2">
        <div>
          <div class="text-sm font-medium text-surface-700 dark:text-surface-300">Enable SSL certificate verification</div>
          <div class="text-xs text-surface-500 dark:text-surface-400 mt-1">When disabled, accepts self-signed and invalid SSL certificates</div>
        </div>
        <div class="flex items-center gap-2">
          <ToggleSwitch v-model="verifySsl" />
          <span class="text-xs font-medium" :class="verifySsl ? 'text-green-600 dark:text-green-400' : 'text-surface-400'">{{ verifySsl ? 'ON' : 'OFF' }}</span>
        </div>
      </div>
      <div class="flex items-center justify-between py-2">
        <div>
          <div class="text-sm font-medium text-surface-700 dark:text-surface-300">Encode URL automatically</div>
          <div class="text-xs text-surface-500 dark:text-surface-400 mt-1">Automatically encode special characters in URL when sending requests</div>
        </div>
        <div class="flex items-center gap-2">
          <ToggleSwitch v-model="autoEncodeUrl" />
          <span class="text-xs font-medium" :class="autoEncodeUrl ? 'text-green-600 dark:text-green-400' : 'text-surface-400'">{{ autoEncodeUrl ? 'ON' : 'OFF' }}</span>
        </div>
      </div>
      <div class="flex items-center justify-between py-2">
        <div>
          <div class="text-sm font-medium text-surface-700 dark:text-surface-300">Accept-Encoding: gzip, deflate, br</div>
          <div class="text-xs text-surface-500 dark:text-surface-400 mt-1">Send compressed encoding header; Rust will decompress the response automatically</div>
        </div>
        <div class="flex items-center gap-2">
          <ToggleSwitch v-model="acceptEncoding" />
          <span class="text-xs font-medium" :class="acceptEncoding ? 'text-green-600 dark:text-green-400' : 'text-surface-400'">{{ acceptEncoding ? 'ON' : 'OFF' }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
