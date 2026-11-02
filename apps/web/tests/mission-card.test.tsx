// @vitest-environment jsdom
// Component test: dashboard mission card reads HashKey-shaped columns.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import MissionCard from '../components/MissionCard';

afterEach(() => {
  cleanup();
});

describe('MissionCard', () => {
  it('renders name, status, current agent, budget, and contract', () => {
    render(
      <MissionCard
        decimals={6}
        mission={{
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Treasury run',
          objective: 'Pay vendors',
          status: 'ACTIVE',
          budget_atomic: '1000000000',
          remaining_budget_atomic: '750000000',
          contract_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          current_agent_address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          created_at: '2026-11-02T00:00:00.000Z',
          updated_at: '2026-11-02T00:00:00.000Z',
        }}
      />
    );
    expect(screen.getByText('Treasury run')).toBeTruthy();
    expect(screen.getByText('ACTIVE')).toBeTruthy();
    expect(screen.getByText('0xaaaa…aaaa')).toBeTruthy();
    expect(screen.getByText('0xbbbb…bbbb')).toBeTruthy();
    expect(screen.getByText('750 / 1,000')).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toEqual(
      '/missions/11111111-1111-4111-8111-111111111111'
    );
  });
});
