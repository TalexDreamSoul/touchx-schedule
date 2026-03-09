<template>
  <NexusConsole :module-key="moduleKey" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import NexusConsole from "../../components/NexusConsole.vue";

const route = useRoute();
const moduleKey = computed(() => String(route.params.module || "overview").trim().toLowerCase());
</script>
