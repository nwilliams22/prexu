/// <reference types="vite/client" />
/// <reference types="vitest/globals" />

declare const __APP_VERSION__: string;

// Augment vitest with vitest-axe matcher types
declare module "vitest" {
  interface Assertion<T = any> {
    toHaveNoViolations(): void;
  }
}
