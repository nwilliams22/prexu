/// <reference types="vite/client" />
/// <reference types="vitest/globals" />

// Augment vitest with vitest-axe matcher types
declare module "vitest" {
  interface Assertion<T = any> {
    toHaveNoViolations(): void;
  }
}
