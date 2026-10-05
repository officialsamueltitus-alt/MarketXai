// ===========================================================================
// Minimal Solana helpers (no SDK): base58, JSON-RPC calls, and a signed Memo transaction for signal proofs.
//
// - RPC: SOLANA_RPC_URL (default: the free public mainnet endpoint). The URL may hold a provider key, so it is never
//   logged or sent to a client; logs show the host only.
// - Wallet: SOLANA_PROOF_SECRET_KEY, the server's own proof wallet (Solana CLI JSON array of 64 numbers, or the base58
//   secret Phantom exports). It only ever signs Memo transactions; it is never logged, returned or stored.
// ===========================================================================
import crypto from 'crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAP = new Map([...ALPHABET].map((c, i) => [c, i]));

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  return '1'.repeat(zeros) + digits.reverse().map(d => ALPHABET[d]).join('');
}

export function base58Decode(text: string): Uint8Array {
  const s = String(text || '');
  let zeros = 0;
  while (zeros < s.length && s[zeros] === '1') zeros++;
  const bytes: number[] = [];
  for (let i = zeros; i < s.length; i++) {
    const v = MAP.get(s[i]);
    if (v === undefined) throw new Error('Invalid base58');
    let carry = v;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  return Uint8Array.from([...new Array(zeros).fill(0), ...bytes.reverse()]);
}

/** A Solana address (32-byte public key in base58) */
export const isSolanaAddress = (s: string) => {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(s || ''))) return false;
  try {
    return base58Decode(s).length === 32;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// RPC
// ---------------------------------------------------------------------------
const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';
export const rpcUrl = () => process.env.SOLANA_RPC_URL || DEFAULT_RPC;
export const rpcHost = () => {
  try {
    return new URL(rpcUrl()).host;
  } catch {
    return 'rpc';
  }
};

export async function solanaRpc<T = any>(method: string, params: unknown[], timeoutMs = 6000): Promise<T> {
  const res = await fetch(rpcUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
  const data: any = await res.json();
  if (data?.error) throw new Error(`RPC ${method}: ${String(data.error?.message || 'error').slice(0, 120)}`);
  return data?.result as T;
}

// ---------------------------------------------------------------------------
// Proof wallet and Memo transactions
// ---------------------------------------------------------------------------
export const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');

export interface ProofWallet {
  address: string;
  publicKey: Uint8Array;
  sign: (message: Uint8Array) => Uint8Array;
}

/** The proof wallet from SOLANA_PROOF_SECRET_KEY, or null (not set or unreadable; the reason is logged without the key) */
export function loadProofWallet(raw = process.env.SOLANA_PROOF_SECRET_KEY): ProofWallet | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    const bytes = text.startsWith('[') ? Uint8Array.from(JSON.parse(text)) : base58Decode(text);
    if (bytes.length !== 64 && bytes.length !== 32) throw new Error('wrong length');
    const seed = Buffer.from(bytes.slice(0, 32));
    const key = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: 'der', type: 'pkcs8' });
    const spki = crypto.createPublicKey(key).export({ format: 'der', type: 'spki' }) as Buffer;
    const publicKey = Uint8Array.from(spki.subarray(spki.length - 32));
    // A 64-byte secret carries its public key: it must match the seed
    if (bytes.length === 64 && Buffer.compare(Buffer.from(bytes.slice(32)), Buffer.from(publicKey)) !== 0) throw new Error('public key mismatch');
    return {
      address: base58Encode(publicKey),
      publicKey,
      sign: message => Uint8Array.from(crypto.sign(null, Buffer.from(message), key)),
    };
  } catch (err: any) {
    console.warn(`[MarketX Proofs] SOLANA_PROOF_SECRET_KEY could not be read (${err?.message || 'invalid'}); proofs stay sealed but are not anchored.`);
    return null;
  }
}

/** Solana's compact-u16 length prefix */
function shortVec(n: number): number[] {
  const out: number[] = [];
  let v = n;
  for (;;) {
    let byte = v & 0x7f;
    v >>= 7;
    if (v) byte |= 0x80;
    out.push(byte);
    if (!v) return out;
  }
}

/**
 * Legacy transaction: one Memo instruction, signed by the fee payer. Returns the wire bytes and the signature (tx id).
 * Co-signers (a trader's MarketX ID) sign the memo too: the Memo program checks they signed, and the transaction shows up
 * in each co-signer's history on any explorer. They are read-only signers and never pay anything.
 */
export function buildMemoTransaction(wallet: ProofWallet, recentBlockhash: string, memo: string, cosigners: ProofWallet[] = []): { wire: Uint8Array; signature: string } {
  const memoBytes = Buffer.from(memo, 'utf8');
  if (memoBytes.length > 500) throw new Error('memo too long');
  const blockhash = base58Decode(recentBlockhash);
  if (blockhash.length !== 32) throw new Error('bad blockhash');
  const extra = cosigners.filter((c, i) => c.address !== wallet.address && cosigners.findIndex(x => x.address === c.address) === i).slice(0, 4);
  const message = Uint8Array.from([
    // Header: fee payer + co-signers sign, the co-signers are read-only, 1 read-only unsigned (the Memo program)
    1 + extra.length, extra.length, 1,
    ...shortVec(2 + extra.length), ...wallet.publicKey, ...extra.flatMap(c => [...c.publicKey]), ...base58Decode(MEMO_PROGRAM_ID),
    ...blockhash,
    // One instruction: the Memo program (last key), the co-signers as its accounts, the memo text as data
    ...shortVec(1), 1 + extra.length, ...shortVec(extra.length), ...extra.map((_, i) => 1 + i), ...shortVec(memoBytes.length), ...memoBytes,
  ]);
  const sigs = [wallet, ...extra].map(w => w.sign(message));
  return { wire: Uint8Array.from([...shortVec(sigs.length), ...sigs.flatMap(sg => [...sg]), ...message]), signature: base58Encode(sigs[0]) };
}

/** Signs and sends a memo; returns its signature (tx id) as soon as the network accepts it */
export async function submitMemo(wallet: ProofWallet, memo: string, cosigners: ProofWallet[] = []): Promise<string> {
  const latest = await solanaRpc<{ value: { blockhash: string } }>('getLatestBlockhash', [{ commitment: 'finalized' }]);
  const { wire, signature } = buildMemoTransaction(wallet, latest.value.blockhash, memo, cosigners);
  await solanaRpc('sendTransaction', [Buffer.from(wire).toString('base64'), { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 3 }], 10000);
  return signature;
}

export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
/** Lamports that keep a plain (no data) account alive on Solana: rent-exempt minimum for 0 bytes */
export const RENT_EXEMPT_EMPTY = 890_880;

/**
 * Activates an address on Solana: the fee payer sends it the rent-exempt minimum (System transfer) and the address
 * co-signs a memo, so explorers show the account as existing, with this first transaction. Legacy transaction,
 * byte-identical to @solana/web3.js. Returns the wire bytes and the signature (tx id).
 */
export function buildActivationTransaction(payer: ProofWallet, account: ProofWallet, recentBlockhash: string, lamports: number, memo: string): { wire: Uint8Array; signature: string } {
  const memoBytes = Buffer.from(memo, 'utf8');
  if (memoBytes.length > 400) throw new Error('memo too long');
  if (account.address === payer.address) throw new Error('same account');
  const blockhash = base58Decode(recentBlockhash);
  if (blockhash.length !== 32) throw new Error('bad blockhash');
  const data = Buffer.alloc(12);
  data.writeUInt32LE(2, 0); // System program: Transfer
  data.writeBigUInt64LE(BigInt(lamports), 4);
  const message = Uint8Array.from([
    // Header: 2 signatures (payer, account), both writable; 2 read-only unsigned (System and Memo programs)
    2, 0, 2,
    ...shortVec(4), ...payer.publicKey, ...account.publicKey, ...base58Decode(SYSTEM_PROGRAM_ID), ...base58Decode(MEMO_PROGRAM_ID),
    ...blockhash,
    ...shortVec(2),
    // Transfer: payer -> account
    2, ...shortVec(2), 0, 1, ...shortVec(data.length), ...data,
    // Memo, signed by the account
    3, ...shortVec(1), 1, ...shortVec(memoBytes.length), ...memoBytes,
  ]);
  const sigs = [payer.sign(message), account.sign(message)];
  return { wire: Uint8Array.from([...shortVec(2), ...sigs[0], ...sigs[1], ...message]), signature: base58Encode(sigs[0]) };
}

export async function submitActivation(payer: ProofWallet, account: ProofWallet, lamports: number, memo: string): Promise<string> {
  const latest = await solanaRpc<{ value: { blockhash: string } }>('getLatestBlockhash', [{ commitment: 'finalized' }]);
  const { wire, signature } = buildActivationTransaction(payer, account, latest.value.blockhash, lamports, memo);
  await solanaRpc('sendTransaction', [Buffer.from(wire).toString('base64'), { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 3 }], 10000);
  return signature;
}

/** Where a sent transaction stands: confirmed (with its slot), failed on chain, or not seen yet */
export async function memoStatus(signature: string): Promise<{ state: 'CONFIRMED'; slot: number | null } | { state: 'FAILED' } | { state: 'UNKNOWN' }> {
  const st = await solanaRpc<{ value: Array<{ slot: number; err: unknown; confirmationStatus?: string } | null> }>('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
  const s = st?.value?.[0];
  if (!s) return { state: 'UNKNOWN' };
  if (s.err) return { state: 'FAILED' };
  if (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized') return { state: 'CONFIRMED', slot: s.slot ?? null };
  return { state: 'UNKNOWN' };
}

/** Sends a memo and waits for confirmation. Throws on failure (the caller retries on its next cycle). */
export async function sendMemo(wallet: ProofWallet, memo: string): Promise<{ signature: string; slot: number | null }> {
  const signature = await submitMemo(wallet, memo);
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, i < 3 ? 1500 : 3000));
    const st = await memoStatus(signature).catch(() => ({ state: 'UNKNOWN' as const }));
    if (st.state === 'FAILED') throw new Error('memo transaction failed');
    if (st.state === 'CONFIRMED') return { signature, slot: st.slot };
  }
  throw new Error('memo not confirmed in time');
}

/** Lamports in the proof wallet (null when unknown) */
export async function walletBalance(address: string): Promise<number | null> {
  try {
    const r = await solanaRpc<{ value: number }>('getBalance', [address, { commitment: 'confirmed' }]);
    return typeof r?.value === 'number' ? r.value : null;
  } catch {
    return null;
  }
}
