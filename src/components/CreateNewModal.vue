<script setup>
import { ref } from 'vue';

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['update:visible', 'create']);

const createOptions = [
  {
    type: 'request',
    label: 'Request',
    icon: 'pi pi-send',
    description: 'Create a new HTTP request'
  },
  {
    type: 'collection',
    label: 'Collection',
    icon: 'pi pi-folder',
    description: 'Create a new collection to organize requests'
  },
  {
    type: 'environment',
    label: 'Environment',
    icon: 'pi pi-globe',
    description: 'Create a new environment with variables'
  }
];

const handleCreate = (type) => {
  emit('create', type);
  emit('update:visible', false);
};

const handleClose = () => {
  emit('update:visible', false);
};
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :closable="true"
    :draggable="false"
    class="create-new-dialog"
    @update:visible="handleClose"
  >
    <template #header>
      <div class="flex items-center gap-2">
        <i class="pi pi-plus-circle"></i>
        <span class="font-semibold">Create New</span>
      </div>
    </template>

    <div class="create-options-grid">
      <div
        v-for="option in createOptions"
        :key="option.type"
        class="create-option-card"
        @click="handleCreate(option.type)"
      >
        <div class="option-icon">
          <i :class="option.icon"></i>
        </div>
        <div class="option-content">
          <h3 class="option-label">{{ option.label }}</h3>
          <p class="option-description">{{ option.description }}</p>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end">
        <Button
          label="Cancel"
          severity="secondary"
          text
          @click="handleClose"
        />
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.create-new-dialog {
  width: 500px;
  max-width: 90vw;
}

.create-options-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 0;
}

.create-option-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--surface-0);
}

.create-option-card:hover {
  background: var(--surface-50);
  border-color: var(--primary-color);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.option-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background: var(--primary-50);
  color: var(--primary-color);
  font-size: 21px;
  flex-shrink: 0;
}

.create-option-card:hover .option-icon {
  background: var(--primary-color);
  color: white;
}

.option-content {
  flex: 1;
}

.option-label {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 4px 0;
  color: var(--text-color);
}

.option-description {
  font-size: 12px;
  margin: 0;
  color: var(--text-color-secondary);
  line-height: 1.4;
}

/* Dark mode adjustments */
:global(.dark) .create-option-card {
  background: var(--surface-900);
  border-color: var(--surface-700);
}

:global(.dark) .create-option-card:hover {
  background: var(--surface-800);
  border-color: var(--primary-color);
}

:global(.dark) .option-icon {
  background: var(--surface-800);
  color: var(--primary-color);
}

:global(.dark) .create-option-card:hover .option-icon {
  background: var(--primary-color);
  color: white;
}
</style>
