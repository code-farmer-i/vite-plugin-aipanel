<script setup lang="ts">
import { computed, useId } from "vue";
import logoSvg from "../assets/logo.svg?raw";

const props = withDefaults(
  defineProps<{
    size?: string | number;
  }>(),
  {
    size: "100%",
  },
);

const baseId = useId();
const gradientId = `aipanel-logo-gradient-${baseId}`;

const rendered = computed(() =>
  logoSvg
    .replace('id="aipanel-logo-gradient"', `id="${gradientId}"`)
    .replace(/url\(#aipanel-logo-gradient\)/g, `url(#${gradientId})`),
);

const sizeStyle = computed(() => {
  const value = typeof props.size === "number" ? `${props.size}px` : props.size;
  return { width: value, height: value };
});
</script>

<template>
  <span
    class="aipanel-logo"
    :style="[{ display: 'inline-block', lineHeight: 0 }, sizeStyle]"
    v-html="rendered"
  />
</template>

<style>
.aipanel-logo svg {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
