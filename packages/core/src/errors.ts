import type { ExplainedError } from './types.ts';

interface PanicRule {
  code: string;
  match: RegExp;
  title: string;
  hint?: (m: RegExpMatchArray, ctx: ErrorContext) => string;
}

export interface ErrorContext {
  executor: string;
  method?: string;
}

// Messages produced by the NEAR runtime and by near-contract-standards (NEP-141/145).
const PANIC_RULES: PanicRule[] = [
  {
    code: 'OUT_OF_GAS',
    match: /Exceeded the prepaid gas/,
    title: 'Ran out of attached gas',
    hint: () => 'Attach more gas to the call (cross-contract calls need gas for every hop and callback).',
  },
  {
    code: 'FT_NOT_REGISTERED',
    match: /The account (\S+) is not registered/,
    title: 'Receiver is not registered on the token',
    hint: (m, ctx) => `Call storage_deposit({"account_id":"${m[1]}"}) on ${ctx.executor} (≈0.00125 NEAR) before sending tokens to it.`,
  },
  {
    code: 'FT_INSUFFICIENT_BALANCE',
    match: /The account doesn't have enough balance/,
    title: 'Sender does not hold enough of this token',
  },
  {
    code: 'NEED_ONE_YOCTO',
    match: /Requires attached deposit of exactly 1 yoctoNEAR/,
    title: 'Method requires exactly 1 yoctoNEAR attached',
    hint: () => 'Sign with a full-access key and attach 1 yoctoNEAR; function-call keys cannot attach deposits.',
  },
  {
    code: 'CONTRACT_NOT_INITIALIZED',
    match: /contract is not initialized/i,
    title: 'Contract has code but was never initialized',
    hint: (_m, ctx) => `${ctx.executor} must be initialized (its init method called) before use.`,
  },
  {
    code: 'STORAGE_DEPOSIT_TOO_LOW',
    match: /attached deposit is less than the minimum storage balance/i,
    title: 'Storage deposit is too small',
  },
  {
    code: 'CONTRACT_PANIC',
    match: /Smart contract panicked: ([\s\S]*)/,
    title: 'Contract rejected the call',
  },
];

const short = (s: string) => s.replace(/, \/[^\s]+\.rs:\d+:\d+$/, '').trim();

export function explainError(raw: unknown, ctx: ErrorContext): ExplainedError {
  const action = (raw as any)?.ActionError;
  const kind = action?.kind;
  const fnErr = kind?.FunctionCallError;

  if (fnErr?.ExecutionError !== undefined) {
    const msg: string = fnErr.ExecutionError;
    for (const rule of PANIC_RULES) {
      const m = msg.match(rule.match);
      if (m) {
        const detail = rule.code === 'CONTRACT_PANIC' ? `${ctx.executor}: ${short(m[1])}` : short(msg);
        return { code: rule.code, title: rule.title, detail, hint: rule.hint?.(m, ctx), raw };
      }
    }
    return { code: 'EXECUTION_ERROR', title: 'Contract execution failed', detail: msg, raw };
  }
  if (fnErr?.MethodResolveError === 'MethodNotFound') {
    return {
      code: 'METHOD_NOT_FOUND',
      title: 'Method does not exist on the contract',
      detail: `${ctx.executor} has no method ${ctx.method ? `"${ctx.method}"` : 'with that name'}.`,
      hint: 'Check the method name against the contract ABI; a wrong name is also a sign of a spoofed or upgraded contract.',
      raw,
    };
  }
  if (fnErr?.CompilationError?.CodeDoesNotExist || fnErr?.CompilationError) {
    return {
      code: 'NO_CONTRACT',
      title: 'Receiver has no contract deployed',
      detail: `${ctx.executor} is a plain account (or its code failed to load); function calls to it cannot work.`,
      raw,
    };
  }
  if (kind?.AccountDoesNotExist) {
    const id = kind.AccountDoesNotExist.account_id;
    return {
      code: 'ACCOUNT_NOT_FOUND',
      title: 'Receiver account does not exist',
      detail: `${id} does not exist on this network.`,
      hint: 'Named accounts must be created before receiving funds; check for typos or look-alike names.',
      raw,
    };
  }
  if (kind?.LackBalanceForState) {
    const { account_id, amount } = kind.LackBalanceForState;
    return {
      code: 'STORAGE_STAKING',
      title: 'Account lacks NEAR to pay for its storage',
      detail: `${account_id} needs ${amount} more yoctoNEAR locked for storage.`,
      hint: `Send NEAR to ${account_id} so it can cover storage, then retry.`,
      raw,
    };
  }
  const invalidTx = (raw as any)?.InvalidTxError;
  if (invalidTx) {
    const key = typeof invalidTx === 'string' ? invalidTx : Object.keys(invalidTx)[0];
    return { code: `INVALID_TX_${String(key).toUpperCase()}`, title: 'Transaction was rejected before execution', detail: JSON.stringify(invalidTx), raw };
  }
  return { code: 'UNKNOWN', title: 'Unrecognized failure', detail: JSON.stringify(raw), raw };
}
