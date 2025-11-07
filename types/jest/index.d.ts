declare namespace jest {
  interface Matchers<R> {
    toBeInTheDocument(): R;
    toHaveTextContent(expected: string | RegExp): R;
  }
}

declare module 'jest';
