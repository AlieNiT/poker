export const denominations = [1, 5, 25, 100];
export const walletValue = wallet => denominations.reduce((sum, value) => sum + (wallet[value] || 0) * value, 0);
export function validWallet(wallet, balance) {
  return wallet && denominations.every(v => Number.isSafeInteger(wallet[v]) && wallet[v] >= 0) && walletValue(wallet) === balance;
}
export function makeWallet(balance) {
  let remaining = balance;
  const counts = {1:0,5:0,25:0,100:0};
  for (const [value, target] of [[1,10],[5,8],[25,6]]) {
    counts[value] = Math.min(target, Math.floor(remaining / value));
    remaining -= counts[value] * value;
  }
  for (const value of [...denominations].reverse()) {
    counts[value] += Math.floor(remaining / value);
    remaining %= value;
  }
  return rollover(counts);
}
export function rollover(wallet) {
  const next = {...wallet};
  for (let i = 0; i < denominations.length - 1; i++) {
    const value = denominations[i], higher = denominations[i + 1], ratio = higher / value;
    const groups = Math.max(0, Math.ceil((next[value] - 10) / ratio));
    next[value] -= groups * ratio;
    next[higher] += groups;
  }
  return next;
}
export function chipCounts(wallet, chips = []) {
  const counts = {...wallet};
  for (const chip of chips) counts[chip.value]++;
  return counts;
}
// Spend existing denominations first, breaking only one larger chip for change.
export function spend(wallet, amount) {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > walletValue(wallet)) throw new Error('Not enough chips.');
  const next = {...wallet};
  let remaining = amount;
  for (const v of [...denominations].reverse()) {
    const count = Math.min(next[v], Math.floor(remaining / v));
    next[v] -= count; remaining -= count * v;
  }
  if (remaining) {
    const v = denominations.find(v => v > remaining && next[v]);
    next[v]--;
    let change = v - remaining;
    for (const small of [...denominations].reverse()) {
      next[small] += Math.floor(change / small); change %= small;
    }
  }
  return rollover(next);
}
export function exchange(wallet, target) {
  if (!denominations.includes(target) || wallet[target] || walletValue(wallet) < target) return null;
  const larger = denominations.find(v => v > target && wallet[v]);
  const next = larger ? {...wallet} : spend(wallet, target);
  if (larger) {
    next[larger]--; next[target] += Math.floor(larger / target);
  } else next[target]++;
  const normalized = rollover(next);
  const give = {}, receive = {};
  for (const v of denominations) {
    if (normalized[v] < wallet[v]) give[v] = wallet[v] - normalized[v];
    if (normalized[v] > wallet[v]) receive[v] = normalized[v] - wallet[v];
  }
  return {target, wallet:normalized, give, receive};
}
export const exchanges = wallet => denominations.map(v => exchange(wallet, v)).filter(Boolean);
