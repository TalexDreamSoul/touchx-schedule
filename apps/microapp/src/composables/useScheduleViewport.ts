import { nextTick, ref } from "vue";

const DEFAULT_WINDOW_WIDTH = 375;
const DEFAULT_CAPSULE_HEIGHT = 32;
const LEFT_ACTIONS_BASE_WIDTH = 96;
const DESIGN_WIDTH = 750;

interface MenuButtonRect {
  top?: number;
  bottom?: number;
  width?: number;
  height?: number;
}

interface UniWithMenuButton {
  getMenuButtonBoundingClientRect?: () => MenuButtonRect;
}

export const useScheduleViewport = () => {
  const topSafeInset = ref(0);
  const capsuleReserveRight = ref(0);
  const leftActionsReserve = ref(0);
  const capsuleTopOffset = ref(0);
  const capsuleHeight = ref(DEFAULT_CAPSULE_HEIGHT);
  const scheduleSwipeViewportWidth = ref(DEFAULT_WINDOW_WIDTH);

  const resolveRuntimeWindowInfo = () => {
    const wxApi = (globalThis as { wx?: Record<string, (...args: any[]) => any> }).wx;
    if (wxApi && typeof wxApi.getWindowInfo === "function") {
      try {
        const windowInfo = wxApi.getWindowInfo() as { statusBarHeight?: number; windowWidth?: number };
        return {
          statusBarHeight: Number(windowInfo.statusBarHeight || 0),
          windowWidth: Number(windowInfo.windowWidth || 0),
        };
      } catch (error) {
        // noop
      }
    }
    try {
      const systemInfo = uni.getSystemInfoSync() as { statusBarHeight?: number; windowWidth?: number };
      return {
        statusBarHeight: Number(systemInfo.statusBarHeight || 0),
        windowWidth: Number(systemInfo.windowWidth || 0),
      };
    } catch (error) {
      return {
        statusBarHeight: 0,
        windowWidth: DEFAULT_WINDOW_WIDTH,
      };
    }
  };

  const resolveTopSafeInset = () => {
    const runtimeWindowInfo = resolveRuntimeWindowInfo();
    const statusBar = Number(runtimeWindowInfo.statusBarHeight || 0);
    const windowWidth = Number(runtimeWindowInfo.windowWidth || DEFAULT_WINDOW_WIDTH);
    scheduleSwipeViewportWidth.value = windowWidth > 0 ? windowWidth : DEFAULT_WINDOW_WIDTH;

    let safeInset = statusBar;
    capsuleReserveRight.value = 0;
    leftActionsReserve.value = Math.ceil((LEFT_ACTIONS_BASE_WIDTH / DESIGN_WIDTH) * windowWidth);
    capsuleTopOffset.value = Math.max(0, statusBar + 4);
    capsuleHeight.value = DEFAULT_CAPSULE_HEIGHT;

    const getMenuRect = (uni as unknown as UniWithMenuButton).getMenuButtonBoundingClientRect;
    if (typeof getMenuRect === "function") {
      const menuRect = getMenuRect();
      const menuTop = Number(menuRect?.top || 0);
      const menuBottom = Number(menuRect?.bottom || 0);
      const menuWidth = Number(menuRect?.width || 0);
      const menuHeight = Number(menuRect?.height || 0);
      if (Number.isFinite(menuBottom) && menuBottom > 0) {
        safeInset = Math.max(safeInset, Math.ceil(menuBottom + 2));
        capsuleReserveRight.value = Math.ceil((menuWidth || LEFT_ACTIONS_BASE_WIDTH) + 12);
        if (Number.isFinite(menuTop) && menuTop > 0) {
          capsuleTopOffset.value = Math.ceil(menuTop);
        }
        if (Number.isFinite(menuHeight) && menuHeight > 0) {
          capsuleHeight.value = Math.ceil(menuHeight);
        }
      }
    }

    if (safeInset <= 0) {
      safeInset = 44 + capsuleHeight.value;
    }
    topSafeInset.value = safeInset;
  };

  const syncScheduleSwipeViewportWidth = () => {
    nextTick(() => {
      const query = uni.createSelectorQuery();
      query.select(".table-wrap").boundingClientRect((result: unknown) => {
        const rect = (Array.isArray(result) ? result[0] : result) as { width?: number | string } | undefined;
        const width = Number(rect?.width || 0);
        if (width > 0) {
          scheduleSwipeViewportWidth.value = width;
        }
      });
      query.exec();
    });
  };

  return {
    topSafeInset,
    capsuleReserveRight,
    leftActionsReserve,
    capsuleTopOffset,
    capsuleHeight,
    scheduleSwipeViewportWidth,
    resolveTopSafeInset,
    syncScheduleSwipeViewportWidth,
  };
};
