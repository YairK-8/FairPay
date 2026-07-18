export function cents(value) {
  return Math.round(Number(value) * 100);
}

export function money(centsValue) {
  return Math.round(centsValue) / 100;
}

export function calculateSettlement({ members, expenses, settlementPayments = [], eventCurrency }) {
  const balances = new Map(members.map((member) => [member.id, 0]));
  let totalExpensesCents = 0;

  for (const expense of expenses) {
    const rate = Number(expense.exchangeRate || 1);
    const convertedTotal = Math.round(expense.amountCents * rate);
    totalExpensesCents += convertedTotal;

    for (const payer of expense.payers) {
      balances.set(payer.userId, (balances.get(payer.userId) || 0) + Math.round(payer.amountCents * rate));
    }

    const participantTotal = expense.participants.reduce((sum, participant) => sum + participant.shareCents, 0);
    const shares = expense.participants.map((participant, index) => {
      if (expense.splitType === "equal") {
        const base = Math.floor(convertedTotal / expense.participants.length);
        const remainder = convertedTotal % expense.participants.length;
        return { userId: participant.userId, shareCents: base + (index < remainder ? 1 : 0) };
      }

      const ratio = participantTotal > 0 ? participant.shareCents / participantTotal : 0;
      return { userId: participant.userId, shareCents: Math.round(convertedTotal * ratio) };
    });

    const drift = convertedTotal - shares.reduce((sum, share) => sum + share.shareCents, 0);
    if (shares.length > 0) shares[0].shareCents += drift;

    for (const share of shares) {
      balances.set(share.userId, (balances.get(share.userId) || 0) - share.shareCents);
    }
  }

  for (const payment of settlementPayments) {
    balances.set(payment.fromUserId, (balances.get(payment.fromUserId) || 0) + payment.amountCents);
    balances.set(payment.toUserId, (balances.get(payment.toUserId) || 0) - payment.amountCents);
  }

  const namedBalances = members.map((member) => ({
    userId: member.id,
    name: member.name,
    avatarUrl: member.avatarUrl || "",
    balanceCents: balances.get(member.id) || 0,
    balance: money(balances.get(member.id) || 0)
  }));

  return {
    balances: namedBalances,
    flows: minimizeFlows(namedBalances),
    totalExpenses: money(totalExpensesCents),
    totalExpensesCents,
    eventCurrency
  };
}

function minimizeFlows(balances) {
  const debtors = balances
    .filter((balance) => balance.balanceCents < 0)
    .map((balance) => ({ ...balance, remaining: -balance.balanceCents }))
    .sort((a, b) => b.remaining - a.remaining);
  const creditors = balances
    .filter((balance) => balance.balanceCents > 0)
    .map((balance) => ({ ...balance, remaining: balance.balanceCents }))
    .sort((a, b) => b.remaining - a.remaining);

  const flows = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = Math.min(debtor.remaining, creditor.remaining);

    if (amount > 0) {
      flows.push({
        fromUserId: debtor.userId,
        fromName: debtor.name,
        fromAvatarUrl: debtor.avatarUrl || "",
        toUserId: creditor.userId,
        toName: creditor.name,
        toAvatarUrl: creditor.avatarUrl || "",
        amountCents: amount,
        amount: money(amount)
      });
    }

    debtor.remaining -= amount;
    creditor.remaining -= amount;
    if (debtor.remaining === 0) debtorIndex += 1;
    if (creditor.remaining === 0) creditorIndex += 1;
  }

  return flows;
}
