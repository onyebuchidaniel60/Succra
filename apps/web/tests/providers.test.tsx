// @vitest-environment jsdom
// Smoke test: wagmi + react-query providers wrap the app tree.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import Providers from '../components/Providers';

afterEach(() => {
  cleanup();
});

describe('Providers', () => {
  it('renders children inside the wagmi and query providers', () => {
    render(
      <Providers>
        <div>mission-control</div>
      </Providers>
    );
    expect(screen.getByText('mission-control')).toBeTruthy();
  });
});
