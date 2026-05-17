export type ReactNode = unknown;

export const createElement = (...args: unknown[]) => ({
  $$typeof: Symbol.for("touchx.react.element"),
  args,
});

export const Fragment = Symbol.for("touchx.react.fragment");

export const useState = <T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void] => {
  const value = typeof initial === "function" ? (initial as () => T)() : initial;
  return [value, () => undefined];
};

export const useEffect = () => undefined;
export const useMemo = <T>(factory: () => T) => factory();

const React = {
  createElement,
  Fragment,
};

export default React;
