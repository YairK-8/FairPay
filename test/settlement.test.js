import test from "node:test";
import assert from "node:assert/strict";
import { calculateSettlement } from "../src/settlement.js";

const members = [
  { id: 1, name: "דניאל" },
  { id: 2, name: "נועה" },
  { id: 3, name: "אורי" },
  { id: 4, name: "לירן" }
];

test("splits cents exactly for equal shares", () => {
  const result = calculateSettlement({
    members: members.slice(0, 3),
    eventCurrency: "ILS",
    expenses: [
      {
        amountCents: 10000,
        exchangeRate: 1,
        splitType: "equal",
        payers: [{ userId: 1, amountCents: 10000 }],
        participants: [
          { userId: 1, shareCents: 0 },
          { userId: 2, shareCents: 0 },
          { userId: 3, shareCents: 0 }
        ]
      }
    ]
  });

  assert.deepEqual(
    result.balances.map((balance) => balance.balanceCents),
    [6666, -3333, -3333]
  );
  assert.equal(result.flows.length, 2);
});

test("supports unequal split", () => {
  const result = calculateSettlement({
    members: members.slice(0, 3),
    eventCurrency: "ILS",
    expenses: [
      {
        amountCents: 30000,
        exchangeRate: 1,
        splitType: "unequal",
        payers: [{ userId: 1, amountCents: 30000 }],
        participants: [
          { userId: 1, shareCents: 10000 },
          { userId: 2, shareCents: 5000 },
          { userId: 3, shareCents: 15000 }
        ]
      }
    ]
  });

  assert.deepEqual(
    result.balances.map((balance) => balance.balanceCents),
    [20000, -5000, -15000]
  );
});

test("supports multiple payers in one expense", () => {
  const result = calculateSettlement({
    members: members.slice(0, 3),
    eventCurrency: "ILS",
    expenses: [
      {
        amountCents: 30000,
        exchangeRate: 1,
        splitType: "equal",
        payers: [
          { userId: 1, amountCents: 20000 },
          { userId: 2, amountCents: 10000 }
        ],
        participants: [
          { userId: 1, shareCents: 0 },
          { userId: 2, shareCents: 0 },
          { userId: 3, shareCents: 0 }
        ]
      }
    ]
  });

  assert.deepEqual(
    result.balances.map((balance) => balance.balanceCents),
    [10000, 0, -10000]
  );
  assert.deepEqual(result.flows.map((flow) => [flow.fromUserId, flow.toUserId, flow.amountCents]), [[3, 1, 10000]]);
});

test("minimizes many expenses into short settlement list", () => {
  const result = calculateSettlement({
    members,
    eventCurrency: "ILS",
    expenses: [
      {
        amountCents: 40000,
        exchangeRate: 1,
        splitType: "equal",
        payers: [{ userId: 1, amountCents: 40000 }],
        participants: members.map((member) => ({ userId: member.id, shareCents: 0 }))
      },
      {
        amountCents: 20000,
        exchangeRate: 1,
        splitType: "equal",
        payers: [{ userId: 2, amountCents: 20000 }],
        participants: members.map((member) => ({ userId: member.id, shareCents: 0 }))
      }
    ]
  });

  assert.equal(result.flows.length, 3);
  assert.equal(result.flows.reduce((sum, flow) => sum + flow.amountCents, 0), 30000);
});

test("converts foreign currency with saved manual rate", () => {
  const result = calculateSettlement({
    members: members.slice(0, 2),
    eventCurrency: "ILS",
    expenses: [
      {
        amountCents: 10000,
        exchangeRate: 1.3,
        splitType: "equal",
        payers: [{ userId: 1, amountCents: 10000 }],
        participants: [
          { userId: 1, shareCents: 0 },
          { userId: 2, shareCents: 0 }
        ]
      }
    ]
  });

  assert.equal(result.totalExpensesCents, 13000);
  assert.deepEqual(
    result.balances.map((balance) => balance.balanceCents),
    [6500, -6500]
  );
});
