/**
 * The slice of React this plugin uses, declared locally.
 *
 * The shell supplies React through the module loader, and the plugin never
 * imports it for anything beyond `createElement` and the hooks below. A local
 * declaration keeps the repository free of a `@types/react` version that would
 * have to track the shell's own React, while still letting `tsc` check that the
 * peer surface is used the way the loader provides it.
 */
declare module 'react' {
  export interface ReactElement {
    type: unknown
    props: Record<string, any> | null
    children?: unknown[]
  }

  export function createElement(type: unknown, props?: Record<string, any> | null, ...children: any[]): ReactElement
  export const Fragment: unknown
  export function useRef<T = any>(initial?: T): { current: T }
  export function useState<T>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void]
  export function useEffect(fn: () => void | (() => void), deps?: readonly unknown[]): void
  export function useLayoutEffect(fn: () => void | (() => void), deps?: readonly unknown[]): void
  export function useSyncExternalStore<T>(
    subscribe: (listener: () => void) => () => void,
    getSnapshot: () => T,
    getServerSnapshot?: () => T,
  ): T

  const React: {
    createElement: typeof createElement
    Fragment: typeof Fragment
    useRef: typeof useRef
    useState: typeof useState
    useEffect: typeof useEffect
    useLayoutEffect: typeof useLayoutEffect
    useSyncExternalStore: typeof useSyncExternalStore
  }

  export default React
}
