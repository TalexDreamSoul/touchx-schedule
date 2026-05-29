declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}

declare module "react" {
  export type ReactNode = unknown;
  export function useState<T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: unknown[]): void;
  export function useMemo<T>(factory: () => T, deps?: unknown[]): T;
  const React: {
    createElement: (...args: unknown[]) => unknown;
    Fragment: unknown;
  };
  export default React;
}

declare module "react/jsx-runtime" {
  export const jsx: (...args: unknown[]) => unknown;
  export const jsxs: (...args: unknown[]) => unknown;
  export const Fragment: unknown;
}
