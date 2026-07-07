<script setup lang="ts">
defineProps<{
  loadingText: string;
}>();
</script>

<template>
  <div class="opencode-custom-loading">
    <div class="opencode-loading-spinner"></div>
    <div class="opencode-loading-text">{{ loadingText }}</div>
  </div>
</template>
