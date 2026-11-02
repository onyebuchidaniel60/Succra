'use client';

// Seven-step on-chain mission creation wizard (PROJECT_SPEC.md §14 screen 3).
// The server builds the exact MissionFactory calldata; the owner's wallet
// signs it, and finalization waits for the authoritative receipt.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSendTransaction,
  useReadContract,
} from 'wagmi';
import { erc20Abi, isAddress } from 'viem';
import { shortenAddress } from '@/lib/format';
import { configuredTokenDecimals } from '@/lib/token-decimals';
import {
  dateToExpiresAt,
  toMissionCreateInput,
  validateWizard,
  validateWizardStep,
  WIZARD_STEPS,
  type MissionWizardDraft,
  type SuccessorDraft,
  type WizardErrors,
} from '@/lib/missions/wizard';

interface CreateMissionResponse {
  missionId: string;
  contractAddress: `0x${string}`;
  predictedContractAddress: `0x${string}`;
  policyHash: `0x${string}`;
  unsignedTransaction: {
    chainId: number;
    to: `0x${string}`;
    data: `0x${string}`;
    value: '0';
  };
  cartMandate: { mandateId: string; mandateHash: `0x${string}` };
}

interface FinalizeResponse {
  missionId: string;
  contractAddress: string;
  status: 'ACTIVE';
}

function apiError(payload: unknown): string {
  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    payload.error &&
    typeof payload.error === 'object' &&
    'message' in payload.error &&
    typeof payload.error.message === 'string'
  ) {
    return payload.error.message;
  }
  return 'Request failed. Retry.';
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="block text-sm">
      <span className="font-medium text-zinc-200">{label}</span>
      {hint ? <span className="mt-0.5 block text-xs text-zinc-400">{hint}</span> : null}
      <div className="mt-2">{children}</div>
      {error ? (
        <span role="alert" className="mt-1 block text-xs text-red-400">
          {error}
        </span>
      ) : null}
    </label>
  );
}

const inputClass =
  'w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors focus:border-emerald-600';

export interface NewMissionWizardProps {
  ownerWallet: string;
  initialDraft: MissionWizardDraft;
}

export default function NewMissionWizard({
  ownerWallet,
  initialDraft,
}: NewMissionWizardProps): React.JSX.Element {
  const router = useRouter();
  const { address, status } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { sendTransactionAsync, isPending: isSending } = useSendTransaction();
  const [draft, setDraft] = useState(initialDraft);
  const tokenAddress = isAddress(draft.paymentTokenAddress)
    ? (draft.paymentTokenAddress as `0x${string}`)
    : undefined;
  const decimalsQuery = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'decimals',
    query: { enabled: tokenAddress !== undefined, staleTime: Infinity },
  });
  const tokenDecimals =
    typeof decimalsQuery.data === 'number'
      ? decimalsQuery.data
      : tokenAddress
        ? configuredTokenDecimals(tokenAddress)
        : null;
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<WizardErrors>({});
  const [submitError, setSubmitError] = useState('');
  const [progress, setProgress] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function patch(values: Partial<MissionWizardDraft>): void {
    setDraft((current) => ({ ...current, ...values }));
  }

  function patchSuccessor(index: number, values: Partial<SuccessorDraft>): void {
    setDraft((current) => ({
      ...current,
      successors: current.successors.map((successor, position) =>
        position === index ? { ...successor, ...values } : successor
      ),
    }));
  }

  function next(): void {
    const stepErrors = validateWizardStep(step, draft, tokenDecimals);
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length > 0) return;
    setStep((current) => Math.min(current + 1, WIZARD_STEPS.length - 1));
  }

  function back(): void {
    setSubmitError('');
    setStep((current) => Math.max(current - 1, 0));
  }

  async function createMission(): Promise<void> {
    if (submitting) return;
    const allErrors = validateWizard(draft, tokenDecimals);
    setErrors(allErrors);
    if (Object.keys(allErrors).length > 0) {
      setSubmitError('Fix the highlighted fields before creating the mission.');
      return;
    }
    if (status !== 'connected' || !address) {
      setSubmitError('Connect your wallet before creating a mission.');
      return;
    }
    if (address.toLowerCase() !== ownerWallet.toLowerCase()) {
      setSubmitError('The connected wallet does not match the signed-in mission owner.');
      return;
    }
    if (tokenDecimals === null) {
      setSubmitError('Token decimals could not be read. Check the token address and retry.');
      return;
    }
    if (!publicClient) {
      setSubmitError('No HashKey RPC client is available. Reload and retry.');
      return;
    }

    setSubmitting(true);
    setSubmitError('');
    try {
      setProgress('Preparing mission…');
      const preparedResponse = await fetch('/api/missions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(toMissionCreateInput(draft, tokenDecimals)),
      });
      const preparedPayload: unknown = await preparedResponse.json();
      if (!preparedResponse.ok) {
        setSubmitError(apiError(preparedPayload));
        return;
      }
      const prepared = preparedPayload as CreateMissionResponse;

      setProgress('Waiting for wallet signature…');
      const txHash = await sendTransactionAsync({
        to: prepared.unsignedTransaction.to,
        data: prepared.unsignedTransaction.data,
        value: BigInt(prepared.unsignedTransaction.value),
        chainId: prepared.unsignedTransaction.chainId,
      });

      setProgress('Confirming mission deployment…');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== 'success') {
        setSubmitError('Mission creation transaction reverted on HashKey.');
        return;
      }

      setProgress('Verifying mission authority…');
      const finalizeResponse = await fetch(`/api/missions/${prepared.missionId}/finalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txHash }),
      });
      const finalizePayload: unknown = await finalizeResponse.json();
      if (!finalizeResponse.ok) {
        setSubmitError(apiError(finalizePayload));
        return;
      }
      const finalized = finalizePayload as FinalizeResponse;
      setProgress('Mission active.');
      router.push(`/missions/${finalized.missionId}`);
    } catch {
      setSubmitError('Mission creation failed. No funds moved; retry when ready.');
    } finally {
      setSubmitting(false);
    }
  }

  const busy = submitting || isSending;
  const tokenLabel = 'USDC';
  const expiresAt = dateToExpiresAt(draft.expiresAt);
  const successorRows = draft.successors;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/70">
      <div className="border-b border-zinc-800 px-5 py-4 sm:px-6">
        <div className="flex flex-wrap gap-2" aria-label="Mission wizard progress">
          {WIZARD_STEPS.map((label, index) => (
            <span
              key={label}
              aria-current={index === step ? 'step' : undefined}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                index === step
                  ? 'border-emerald-700 bg-emerald-950 text-emerald-300'
                  : index < step
                    ? 'border-zinc-600 text-zinc-300'
                    : 'border-zinc-800 text-zinc-400'
              }`}
            >
              {index + 1}. {label}
            </span>
          ))}
        </div>
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full bg-emerald-500 transition-[width] duration-200"
            style={{ width: `${((step + 1) / WIZARD_STEPS.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="space-y-5 px-5 py-6 sm:px-6">
        {step === 0 ? (
          <>
            <Field label="Mission name" error={errors['name']}>
              <input
                className={inputClass}
                value={draft.name}
                maxLength={120}
                onChange={(event) => patch({ name: event.currentTarget.value })}
                placeholder="Q4 vendor payouts"
              />
            </Field>
            <Field
              label="Objective"
              hint="What is this mission allowed to accomplish?"
              error={errors['objective']}
            >
              <textarea
                className={`${inputClass} min-h-24`}
                value={draft.objective}
                maxLength={2000}
                onChange={(event) => patch({ objective: event.currentTarget.value })}
                placeholder="Pay allowlisted vendors on a fixed weekly schedule."
              />
            </Field>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <Field
              label="Settlement token address"
              hint="One ERC-20 token per mission. Payments execute through HSP."
              error={errors['paymentTokenAddress']}
            >
              <input
                className={`${inputClass} font-mono`}
                value={draft.paymentTokenAddress}
                onChange={(event) => patch({ paymentTokenAddress: event.currentTarget.value })}
                placeholder="0x…"
                spellCheck={false}
              />
              {tokenAddress ? (
                <p className="mt-1 text-xs text-zinc-400">
                  {decimalsQuery.isLoading
                    ? 'Reading token decimals…'
                    : tokenDecimals === null
                      ? 'Token decimals unavailable; amounts cannot be converted safely.'
                      : `Token decimals: ${tokenDecimals}`}
                </p>
              ) : null}
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={`Budget (${tokenLabel})`} error={errors['budget']}>
                <input
                  className={inputClass}
                  inputMode="decimal"
                  value={draft.budget}
                  onChange={(event) => patch({ budget: event.currentTarget.value })}
                  placeholder="1000"
                />
              </Field>
              <Field label={`Per-payment ceiling (${tokenLabel})`} error={errors['maxPayment']}>
                <input
                  className={inputClass}
                  inputMode="decimal"
                  value={draft.maxPayment}
                  onChange={(event) => patch({ maxPayment: event.currentTarget.value })}
                  placeholder="100"
                />
              </Field>
              <Field
                label={`Recovery ceiling (${tokenLabel})`}
                error={errors['recoveryMaxPayment']}
              >
                <input
                  className={inputClass}
                  inputMode="decimal"
                  value={draft.recoveryMaxPayment}
                  onChange={(event) => patch({ recoveryMaxPayment: event.currentTarget.value })}
                  placeholder="50"
                />
              </Field>
            </div>
            <Field label="Expiry" hint="Payments stop after this date." error={errors['expiresAt']}>
              <input
                type="date"
                className={inputClass}
                value={draft.expiresAt}
                onChange={(event) => patch({ expiresAt: event.currentTarget.value })}
              />
            </Field>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold">Merchant allowlist</h2>
                <p className="mt-1 text-sm text-zinc-400">
                  Every payment must target one of these addresses.
                </p>
              </div>
              <button
                type="button"
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200"
                onClick={() => patch({ merchantAllowlist: [...draft.merchantAllowlist, ''] })}
              >
                Add merchant
              </button>
            </div>
            <div className="space-y-3">
              {draft.merchantAllowlist.map((merchant, index) => (
                <div key={`merchant-${index}`} className="flex gap-2">
                  <input
                    aria-label={`Merchant ${index + 1} address`}
                    className={`${inputClass} font-mono`}
                    value={merchant}
                    onChange={(event) => {
                      const nextValue = [...draft.merchantAllowlist];
                      nextValue[index] = event.currentTarget.value;
                      patch({ merchantAllowlist: nextValue });
                    }}
                    placeholder="0x…"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    aria-label={`Remove merchant ${index + 1}`}
                    className="rounded-md border border-zinc-700 px-3 text-sm text-zinc-400"
                    onClick={() =>
                      patch({
                        merchantAllowlist:
                          draft.merchantAllowlist.length === 1
                            ? ['']
                            : draft.merchantAllowlist.filter((_, position) => position !== index),
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            {errors['merchantAllowlist'] ? (
              <p role="alert" className="text-sm text-red-400">
                {errors['merchantAllowlist']}
              </p>
            ) : null}
          </>
        ) : null}

        {step === 3 ? (
          <>
            <Field
              label="Primary agent address"
              hint="The agent that executes payments until it is quarantined."
              error={errors['primaryAgentAddress']}
            >
              <input
                className={`${inputClass} font-mono`}
                value={draft.primaryAgentAddress}
                onChange={(event) => patch({ primaryAgentAddress: event.currentTarget.value })}
                placeholder="0x…"
                spellCheck={false}
              />
            </Field>
            <Field
              label="Agent label (optional)"
              hint="Stored in the dashboard as a human-readable name."
            >
              <input
                className={inputClass}
                value={draft.primaryAgentName}
                onChange={(event) => patch({ primaryAgentName: event.currentTarget.value })}
                placeholder="Alpha"
              />
            </Field>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold">Pre-approved successors</h2>
                <p className="mt-1 text-sm text-zinc-400">
                  Lower priority wins. Successors receive only recovery authority.
                </p>
              </div>
              <button
                type="button"
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 disabled:opacity-50"
                disabled={successorRows.length >= 8}
                onClick={() =>
                  patch({
                    successors: [
                      ...successorRows,
                      { address: '', priority: String(successorRows.length + 1) },
                    ],
                  })
                }
              >
                Add successor
              </button>
            </div>
            {successorRows.length === 0 ? (
              <p className="rounded-md border border-dashed border-zinc-800 p-4 text-sm text-zinc-400">
                No successors yet. The mission can still be created, but it cannot recover from
                quarantine.
              </p>
            ) : (
              <div className="space-y-3">
                {successorRows.map((successor, index) => (
                  <div
                    key={`successor-${index}`}
                    className="grid gap-2 sm:grid-cols-[1fr_110px_auto]"
                  >
                    <div>
                      <input
                        aria-label={`Successor ${index + 1} address`}
                        className={`${inputClass} font-mono`}
                        value={successor.address}
                        onChange={(event) =>
                          patchSuccessor(index, { address: event.currentTarget.value })
                        }
                        placeholder="0x…"
                        spellCheck={false}
                      />
                      {errors[`successors.${index}.address`] ? (
                        <p role="alert" className="mt-1 text-xs text-red-400">
                          {errors[`successors.${index}.address`]}
                        </p>
                      ) : null}
                    </div>
                    <div>
                      <input
                        aria-label={`Successor ${index + 1} priority`}
                        className={inputClass}
                        inputMode="numeric"
                        value={successor.priority}
                        onChange={(event) =>
                          patchSuccessor(index, { priority: event.currentTarget.value })
                        }
                        placeholder="1"
                      />
                      {errors[`successors.${index}.priority`] ? (
                        <p role="alert" className="mt-1 text-xs text-red-400">
                          {errors[`successors.${index}.priority`]}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove successor ${index + 1}`}
                      className="rounded-md border border-zinc-700 px-3 text-sm text-zinc-400"
                      onClick={() =>
                        patch({
                          successors: successorRows.filter((_, position) => position !== index),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            {successorRows.length >= 8 ? (
              <p className="text-xs text-amber-300">Successor limit reached (8).</p>
            ) : null}
            {errors['successors'] ? (
              <p role="alert" className="text-sm text-red-400">
                {errors['successors']}
              </p>
            ) : null}
          </>
        ) : null}

        {step === 5 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Violation threshold"
              hint="Consecutive policy violations before quarantine (1–10)."
              error={errors['violationThreshold']}
            >
              <input
                className={inputClass}
                inputMode="numeric"
                value={draft.violationThreshold}
                onChange={(event) => patch({ violationThreshold: event.currentTarget.value })}
              />
            </Field>
            <Field
              label="Violation window (seconds)"
              hint="60–86400 seconds. The streak resets outside this window."
              error={errors['violationWindowSeconds']}
            >
              <input
                className={inputClass}
                inputMode="numeric"
                value={draft.violationWindowSeconds}
                onChange={(event) => patch({ violationWindowSeconds: event.currentTarget.value })}
              />
            </Field>
          </div>
        ) : null}

        {step === 6 ? (
          <div className="space-y-5">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
              <h2 className="font-semibold">{draft.name}</h2>
              <p className="mt-1 text-sm text-zinc-400">{draft.objective}</p>
            </div>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-zinc-400">Settlement token</dt>
                <dd className="mt-0.5 break-all font-mono text-xs text-zinc-200">
                  {draft.paymentTokenAddress}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-400">Expiry</dt>
                <dd className="mt-0.5 text-zinc-200">{expiresAt ?? draft.expiresAt}</dd>
              </div>
              <div>
                <dt className="text-zinc-400">Budget</dt>
                <dd className="mt-0.5 font-mono text-zinc-200">
                  {draft.budget} {tokenLabel}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-400">Per-payment ceiling</dt>
                <dd className="mt-0.5 font-mono text-zinc-200">
                  {draft.maxPayment} {tokenLabel}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-400">Recovery ceiling</dt>
                <dd className="mt-0.5 font-mono text-zinc-200">
                  {draft.recoveryMaxPayment} {tokenLabel}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-400">Violations</dt>
                <dd className="mt-0.5 text-zinc-200">
                  {draft.violationThreshold} within {draft.violationWindowSeconds}s
                </dd>
              </div>
              <div>
                <dt className="text-zinc-400">Primary agent</dt>
                <dd className="mt-0.5 break-all font-mono text-xs text-zinc-200">
                  {shortenAddress(draft.primaryAgentAddress, 6)}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-400">Successors</dt>
                <dd className="mt-0.5 text-zinc-200">
                  {successorRows.filter((row) => row.address.trim()).length}
                </dd>
              </div>
            </dl>
            <div>
              <h3 className="text-sm font-medium text-zinc-300">Merchants</h3>
              <ul className="mt-2 space-y-1">
                {draft.merchantAllowlist
                  .filter((merchant) => merchant.trim())
                  .map((merchant) => (
                    <li key={merchant} className="break-all font-mono text-xs text-zinc-400">
                      {merchant}
                    </li>
                  ))}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-medium text-zinc-300">Successors</h3>
              {successorRows.filter((row) => row.address.trim()).length === 0 ? (
                <p className="mt-1 text-sm text-zinc-400">None.</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {successorRows
                    .filter((row) => row.address.trim())
                    .map((successor) => (
                      <li key={successor.address} className="flex justify-between gap-4 text-xs">
                        <span className="break-all font-mono text-zinc-400">
                          {successor.address}
                        </span>
                        <span className="font-mono text-zinc-300">P{successor.priority}</span>
                      </li>
                    ))}
                </ul>
              )}
            </div>
            {status !== 'connected' ? (
              <p
                role="alert"
                className="rounded-md border border-amber-800 bg-amber-950/60 p-3 text-sm text-amber-200"
              >
                Connect your wallet to sign the mission deployment.
              </p>
            ) : address && address.toLowerCase() !== ownerWallet.toLowerCase() ? (
              <p
                role="alert"
                className="rounded-md border border-red-800 bg-red-950/60 p-3 text-sm text-red-200"
              >
                Connected wallet {shortenAddress(address, 6)} does not match the signed-in owner{' '}
                {shortenAddress(ownerWallet, 6)}.
              </p>
            ) : null}
            {submitError ? (
              <p
                role="alert"
                className="rounded-md border border-red-800 bg-red-950/60 p-3 text-sm text-red-200"
              >
                {submitError}
              </p>
            ) : null}
            {progress ? (
              <p role="status" className="text-sm text-zinc-400">
                {progress}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-zinc-800 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          {step > 0 ? (
            <button
              type="button"
              onClick={back}
              disabled={busy}
              className="w-full rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 disabled:opacity-50 sm:w-auto"
            >
              Back
            </button>
          ) : (
            <Link href="/dashboard" className="text-sm text-zinc-400 underline underline-offset-4">
              Cancel
            </Link>
          )}
        </div>
        {step < WIZARD_STEPS.length - 1 ? (
          <button
            type="button"
            onClick={next}
            className="w-full rounded-md bg-emerald-500 px-4 py-2 font-semibold text-zinc-950 disabled:opacity-50 sm:w-auto"
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void createMission()}
            disabled={busy}
            className="w-full rounded-md bg-emerald-500 px-4 py-2 font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {busy ? progress || 'Working…' : 'Create mission'}
          </button>
        )}
      </div>
      {chainId !== 177 && chainId !== 133 ? (
        <p className="border-t border-amber-900/50 px-5 py-3 text-xs text-amber-300 sm:px-6">
          Wallet network is {chainId}; switch to HashKey mainnet (177) or testnet (133) before
          signing.
        </p>
      ) : null}
    </div>
  );
}
