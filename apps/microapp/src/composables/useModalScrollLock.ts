import { onBeforeUnmount, watch, type Ref } from "vue";

export const useModalScrollLock = (isLocked: Ref<boolean>) => {
  const setLocked = (locked: boolean) => {
    if (typeof document === "undefined") {
      return;
    }
    const body = document.body;
    if (!body) {
      return;
    }
    body.style.overflow = locked ? "hidden" : "";
    body.style.touchAction = locked ? "none" : "";
  };

  watch(isLocked, (locked) => setLocked(locked), { immediate: true });

  onBeforeUnmount(() => {
    setLocked(false);
  });
};
