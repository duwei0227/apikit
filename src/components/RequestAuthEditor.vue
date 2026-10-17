<script setup lang="ts">
import VariableInput from './VariableInput.vue';

// The request auth object (localRequest.auth) is two-way bound; this component
// edits type / token / username / password in place.
const auth = defineModel('auth', { type: Object, required: true });

defineProps({
  availableVariables: { type: Object, default: () => ({}) },
});

const authTypes = [
  { label: 'No Auth', value: 'none' },
  { label: 'Bearer Token', value: 'bearer' },
  { label: 'Basic Auth', value: 'basic' }
];
</script>

<template>
  <div class="p-4 overflow-y-auto">
    <div class="mb-4">
      <label class="block text-sm font-medium mb-2">Type</label>
      <Dropdown
        v-model="auth.type"
        :options="authTypes"
        optionLabel="label"
        optionValue="value"
        class="w-full"
      />
    </div>

    <!-- Bearer Token -->
    <div v-if="auth.type === 'bearer'" class="space-y-4">
      <div>
        <label class="block text-sm font-medium mb-2">Token</label>
        <VariableInput
          v-model="auth.token"
          placeholder="Enter bearer token"
          :availableVariables="availableVariables"
        />
      </div>
    </div>

    <!-- Basic Auth -->
    <div v-if="auth.type === 'basic'" class="space-y-4">
      <div>
        <label class="block text-sm font-medium mb-2">Username</label>
        <VariableInput
          v-model="auth.username"
          placeholder="Enter username"
          :availableVariables="availableVariables"
        />
      </div>
      <div>
        <label class="block text-sm font-medium mb-2">Password</label>
        <Password
          v-model="auth.password"
          placeholder="Enter password"
          :feedback="false"
          toggleMask
          inputClass="w-full"
          class="w-full password-full-width"
        />
      </div>
    </div>

    <!-- No Auth -->
    <div v-if="auth.type === 'none'" class="text-sm text-surface-500 dark:text-surface-400">
      This request does not use any authorization.
    </div>
  </div>
</template>
