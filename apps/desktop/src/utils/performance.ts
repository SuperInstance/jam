/**
 * Performance utility functions for React components
 */
import React from 'react';

/**
 * Memoize component with a custom comparison function that checks specific properties
 * This is useful for preventing unnecessary re-renders when only some props matter
 */
export function memoByProps<T extends Record<string, unknown>>(
  Component: React.FC<T>,
  propKeys: (keyof T)[]
): React.FC<T> {
  return React.memo(Component, (prevProps, nextProps) => {
    // Only re-render if specified props change
    for (const key of propKeys) {
      if (prevProps[key] !== nextProps[key]) {
        return false; // Props differ, should re-render
      }
    }
    return true; // All relevant props are equal, skip re-render
  });
}

/**
 * Deep equality check for objects (useful for complex prop comparison)
 */
export function shallowEqual(objA: unknown, objB: unknown): boolean {
  if (objA === objB) {
    return true;
  }

  if (
    typeof objA !== 'object' ||
    objA === null ||
    typeof objB !== 'object' ||
    objB === null
  ) {
    return false;
  }

  const keysA = Object.keys(objA as Record<string, unknown>);
  const keysB = Object.keys(objB as Record<string, unknown>);

  if (keysA.length !== keysB.length) {
    return false;
  }

  for (const key of keysA) {
    if (
      !(objB as Record<string, unknown>).hasOwnProperty(key) ||
      (objA as Record<string, unknown>)[key] !== (objB as Record<string, unknown>)[key]
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Throttle a function to limit how often it can be called
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      func(...args);
    }
  };
}
