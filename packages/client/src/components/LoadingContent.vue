<script setup lang="ts">
defineProps<{
  loadingText: string;
}>();
</script>

<template>
  <div class="aipanel-custom-loading">
    <div class="aipanel-loading-spinner"></div>
    <div class="aipanel-loading-text">{{ loadingText }}</div>
  </div>
</template>
