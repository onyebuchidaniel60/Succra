// Succra web — mission wizard state and per-step validation.
//
// Pure functions so the seven-step wizard can be tested without a browser.
// Human-readable token amounts are converted to atomic strings only at the
// boundary; all API/on-chain values remain decimal integer strings.
import { isAddress, parseUnits } from 'viem';
import { DEFAULT_TOKEN_DECIMALS } from '@/lib/format';
import {
  MAX_SUCCESSORS,
  MAX_VIOLATION_THRESHOLD,
  MAX_VIOLATION_WINDOW_SECONDS,
  MIN_VIOLATION_WINDOW_SECONDS,
  type MissionCreateInput,
} from '@/lib/missions';

export const WIZARD_STEPS = [
  'Mission',
  'Authority',
  'Merchants',
  'Primary agent',
  'Successors',
  'Policy',
  'Review',
] as const;

export type WizardStep = number;

export interface SuccessorDraft {
  address: string;
  priority: string;
}

export interface MissionWizardDraft {
  name: string;
  objective: string;
  paymentTokenAddress: string;
  budget: string;
  maxPayment: string;
  recoveryMaxPayment: string;
  expiresAt: string;
  merchantAllowlist: string[];
  primaryAgentAddress: string;
  primaryAgentName: string;
  successors: SuccessorDraft[];
  violationThreshold: string;
  violationWindowSeconds: string;
}

export type WizardErrors = Record<string, string>;

export function defaultExpiryDate(now = new Date()): string {
  const date = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

export function defaultWizardDraft(): MissionWizardDraft {
  return {
    name: '',
    objective: '',
    paymentTokenAddress: process.env.NEXT_PUBLIC_DEFAULT_PAYMENT_TOKEN_ADDRESS ?? '',
    budget: '',
    maxPayment: '',
    recoveryMaxPayment: '',
    expiresAt: defaultExpiryDate(),
    merchantAllowlist: [''],
    primaryAgentAddress: '',
    primaryAgentName: '',
    successors: [],
    violationThreshold: '3',
    violationWindowSeconds: '900',
  };
}

/** Date-only input -> ISO timestamp at the end of that UTC day. */
export function dateToExpiresAt(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T23:59:59.000Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function parseTokenAmount(
  value: string,
  decimals = DEFAULT_TOKEN_DECIMALS
): { atomic: string } | { error: string } {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { error: 'Enter an amount.' };
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { error: 'Use a positive decimal amount.' };
  const fraction = trimmed.split('.')[1] ?? '';
  if (fraction.length > decimals) {
    return { error: `Use at most ${decimals} decimal places.` };
  }
  try {
    const atomic = parseUnits(trimmed, decimals);
    if (atomic <= 0n) return { error: 'Amount must be greater than zero.' };
    return { atomic: atomic.toString() };
  } catch {
    return { error: 'Amount is out of range.' };
  }
}

function positiveInteger(value: string, min: number, max: number, field: string): string | null {
  if (!/^\d+$/.test(value.trim())) return `${field} must be a whole number.`;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    return `${field} must be between ${min} and ${max}.`;
  }
  return null;
}

function validateAmounts(draft: MissionWizardDraft): WizardErrors {
  const errors: WizardErrors = {};
  const budget = parseTokenAmount(draft.budget);
  const maxPayment = parseTokenAmount(draft.maxPayment);
  const recovery = parseTokenAmount(draft.recoveryMaxPayment);
  if ('error' in budget) errors['budget'] = budget.error;
  if ('error' in maxPayment) errors['maxPayment'] = maxPayment.error;
  if ('error' in recovery) errors['recoveryMaxPayment'] = recovery.error;
  if (!('error' in budget) && !('error' in maxPayment)) {
    if (BigInt(maxPayment.atomic) > BigInt(budget.atomic)) {
      errors['maxPayment'] = 'Per-payment ceiling cannot exceed the budget.';
    }
  }
  if (!('error' in maxPayment) && !('error' in recovery)) {
    if (BigInt(recovery.atomic) > BigInt(maxPayment.atomic)) {
      errors['recoveryMaxPayment'] = 'Recovery ceiling cannot exceed the per-payment ceiling.';
    }
  }
  return errors;
}

export function validateWizardStep(step: WizardStep, draft: MissionWizardDraft): WizardErrors {
  const errors: WizardErrors = {};
  if (step === 0) {
    if (draft.name.trim().length === 0) errors['name'] = 'Mission name is required.';
    if (draft.name.trim().length > 120) errors['name'] = 'Use 120 characters or fewer.';
    if (draft.objective.trim().length === 0) errors['objective'] = 'Objective is required.';
    if (draft.objective.trim().length > 2000) errors['objective'] = 'Use 2000 characters or fewer.';
    return errors;
  }
  if (step === 1) {
    if (!isAddress(draft.paymentTokenAddress)) {
      errors['paymentTokenAddress'] = 'Enter a valid EVM token address.';
    }
    Object.assign(errors, validateAmounts(draft));
    const expiresAt = dateToExpiresAt(draft.expiresAt);
    if (!expiresAt || Date.parse(expiresAt) <= Date.now()) {
      errors['expiresAt'] = 'Choose a future expiry date.';
    }
    return errors;
  }
  if (step === 2) {
    const merchants = draft.merchantAllowlist.map((value) => value.trim()).filter(Boolean);
    if (merchants.length === 0) errors['merchantAllowlist'] = 'Add at least one merchant.';
    if (merchants.some((value) => !isAddress(value))) {
      errors['merchantAllowlist'] = 'Every merchant must be a valid EVM address.';
    }
    if (new Set(merchants.map((value) => value.toLowerCase())).size !== merchants.length) {
      errors['merchantAllowlist'] = 'Merchant addresses must be unique.';
    }
    return errors;
  }
  if (step === 3) {
    if (!isAddress(draft.primaryAgentAddress)) {
      errors['primaryAgentAddress'] = 'Enter a valid primary agent address.';
    }
    return errors;
  }
  if (step === 4) {
    const active = draft.successors.filter(
      (successor) => successor.address.trim().length > 0 || successor.priority.trim().length > 0
    );
    if (active.length > MAX_SUCCESSORS) {
      errors['successors'] = `At most ${MAX_SUCCESSORS} successors are allowed.`;
      return errors;
    }
    for (const [index, successor] of active.entries()) {
      if (!isAddress(successor.address)) {
        errors[`successors.${index}.address`] = 'Enter a valid successor address.';
      }
      const priorityError = positiveInteger(successor.priority, 0, 65_535, 'Priority');
      if (priorityError) errors[`successors.${index}.priority`] = priorityError;
    }
    const addresses = active.map((successor) => successor.address.trim().toLowerCase());
    if (new Set(addresses).size !== addresses.length) {
      errors['successors'] = 'Successor addresses must be unique.';
    }
    if (addresses.includes(draft.primaryAgentAddress.trim().toLowerCase())) {
      errors['successors'] = 'The primary agent cannot also be a successor.';
    }
    return errors;
  }
  if (step === 5) {
    const thresholdError = positiveInteger(
      draft.violationThreshold,
      1,
      MAX_VIOLATION_THRESHOLD,
      'Violation threshold'
    );
    if (thresholdError) errors['violationThreshold'] = thresholdError;
    const windowError = positiveInteger(
      draft.violationWindowSeconds,
      MIN_VIOLATION_WINDOW_SECONDS,
      MAX_VIOLATION_WINDOW_SECONDS,
      'Violation window'
    );
    if (windowError) errors['violationWindowSeconds'] = windowError;
    return errors;
  }
  return errors;
}

export function validateWizard(draft: MissionWizardDraft): WizardErrors {
  const errors: WizardErrors = {};
  for (let step = 0; step < WIZARD_STEPS.length - 1; step += 1) {
    Object.assign(errors, validateWizardStep(step, draft));
  }
  return errors;
}

/** Convert a valid wizard draft into the POST /api/missions body. */
export function toMissionCreateInput(draft: MissionWizardDraft): MissionCreateInput {
  const budget = parseTokenAmount(draft.budget);
  const maxPayment = parseTokenAmount(draft.maxPayment);
  const recovery = parseTokenAmount(draft.recoveryMaxPayment);
  const expiresAt = dateToExpiresAt(draft.expiresAt);
  if ('error' in budget || 'error' in maxPayment || 'error' in recovery || !expiresAt) {
    throw new Error('Wizard draft is invalid.');
  }
  return {
    name: draft.name.trim(),
    objective: draft.objective.trim(),
    paymentTokenAddress: draft.paymentTokenAddress.trim().toLowerCase() as `0x${string}`,
    budgetAtomic: budget.atomic,
    maxPaymentAtomic: maxPayment.atomic,
    recoveryMaxPaymentAtomic: recovery.atomic,
    merchantAllowlist: draft.merchantAllowlist
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => value.toLowerCase() as `0x${string}`),
    expiresAt,
    primaryAgentAddress: draft.primaryAgentAddress.trim().toLowerCase() as `0x${string}`,
    ...(draft.primaryAgentName.trim() ? { primaryAgentName: draft.primaryAgentName.trim() } : {}),
    successors: draft.successors
      .filter((successor) => successor.address.trim().length > 0)
      .map((successor) => ({
        address: successor.address.trim().toLowerCase() as `0x${string}`,
        priority: Number(successor.priority),
      })),
    violationThreshold: Number(draft.violationThreshold),
    violationWindowSeconds: Number(draft.violationWindowSeconds),
  } as MissionCreateInput;
}
