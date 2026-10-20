# Feature Queue

Everything below is scoped but not built. The order is the order they are
queued in; each entry says what it depends on, so the plan in
`Local Expense Tracker & Budgeter Product and Technical Plan.md` can be walked
without surprises.

Milestone numbers refer to the plan's milestone table. "M5+" means it lands
after the dashboard work.

| # | Feature | Anxiety it removes | Needs | Milestone |
| --- | --- | --- | --- | --- |
| 1 | Safe-to-spend amount | "Can I afford to spend money today?" | bills, goals, buffer | M5+ |
| 2 | Money-until-payday forecast | "Will I run out before my next salary?" | bills, income schedule | M5+ |
| 3 | Upcoming bills and commitments | "What am I forgetting?" | `commitments` table | M5+ |
| 4 | Savings goal impact calculator | "Am I sacrificing my future?" | `goals` table | M5+ |
| 5 | Emergency buffer tracker | "What if something goes wrong?" | buffer setting, essential spend | M5+ |
| 6 | Flexible spending limits | "Am I overspending?" | `budgets` table (M6) | M6 |
| 7 | Spending pace and history | "Is this normal or dangerous?" | summary tables, monthly history | M5 |
| 8 | What-if simulator | "What happens if I buy this?" | dashboard model | M5+ |
| 9 | Quick capture and reconciliation | "My numbers are probably wrong" | manual entry, import, edits | M4 (partial) |
| 10 | Financial recovery plan | "I've already messed up" | budgets, goals, plan engine | M6+ |

---

## 1. Safe-to-spend amount

*Essential. Anxiety it reduces: "Can I afford to spend money today?"*

Show one clear amount the user can spend without jeopardising essential bills,
savings commitments or their minimum cash buffer.

Must include:

- Safe to spend today, this week and until payday.
- Automatic recalculation after each transaction.
- A breakdown showing how the amount was calculated.

Example: *"You can spend ₹700 today and still cover your upcoming bills and
planned savings."*

Needs: the bill timeline (#3), the goals (#4) and the buffer (#5). The formula
is `balance − upcoming commitments − planned savings − buffer`, spread over the
days left. The breakdown is the app showing its work, which is the same
principle the dashboard follows.

## 2. Money-until-payday forecast

*Essential. Anxiety it reduces: "Will I run out of money before my next
salary?"*

Project the balance day by day until the next income arrives, accounting for
scheduled bills and expected spending.

Must include:

- Projected balance on payday.
- Lowest projected balance before payday.
- A warning when the balance may fall below a chosen threshold.
- Clear assumptions about future spending.

Example: *"At your current spending pace, you'll have approximately ₹4,200 left
on payday."*

Needs: the bill timeline (#3) and a way to say when money arrives. Salary is
currently only visible as a credit in the transaction list, so an income
schedule has to exist before this can be honest.

## 3. Upcoming bills and commitments

*Essential. Anxiety it reduces: "What am I forgetting? What if several payments
hit at once?"*

A single timeline for rent, utilities, subscriptions, EMIs, credit card payments
and other upcoming obligations.

Must include:

- Due dates and amounts.
- Recurring payment schedules.
- Paid, pending and overdue states.
- Projected balance after each payment.

Example: *"Rent ₹18,000 is due on the 1st, and three card payments land before
then."*

Needs: a `commitments` table (id, name, amount, due day, recurrence, category).
The plan's `recurring` table detects subscriptions from spending history; it
cannot know about a bill that has not been paid yet, so the two are different
things and both are needed.

## 4. Savings goal impact calculator

*Essential. Anxiety it reduces: "Am I sacrificing my future every time I
spend?"*

Every goal has a target amount, current savings, target date and planned
contribution. Show how a new expense changes the projected completion date.

Must include:

- Multiple goals with adjustable priorities.
- Progress and estimated completion dates.
- Before-and-after impact of a proposed expense.
- The contribution required to get back on track.

Example: *"This ₹3,000 purchase delays your laptop goal by 6 days."*

Needs: a `goals` table (id, name, target amount, saved amount, target date,
monthly contribution, priority). The impact calculation needs the simulator
(#8) underneath it.

## 5. Emergency buffer tracker

*Essential. Anxiety it reduces: "What happens if something unexpected goes
wrong?"*

Track money reserved for emergencies separately from money available for everyday
spending.

Must include:

- User-defined minimum cash reserve.
- Progress toward a chosen emergency fund target.
- How many days or months of essential expenses the reserve covers.
- A warning when spending would breach the reserve.

Example: *"Your emergency fund covers 1.4 months of essential expenses. Your
target is 3 months."*

Needs: a reserve setting and a definition of essential spend (the categories
marked essential by the user). The buffer is money that exists but is not
spendable, so it has to be subtracted before any safe-to-spend number.

## 6. Flexible spending limits

*Essential. Anxiety it reduces: "Am I overspending? Do I have to feel guilty
about every purchase?"*

Set realistic limits for discretionary categories, with a clear remaining amount
instead of simply showing how much has already been spent.

Must include:

- Daily, weekly and monthly views.
- Adjustable category limits.
- Remaining allowance and projected overspend.
- Graceful handling of one-off expenses.

Example: *"You've used 60% of your dining budget, with 12 days remaining."*

Needs: the `budgets` table from the plan (M6), plus the category breakdown from
M5 so the remaining amount can be computed. The plan's budget model already
carries a period, a limit and rollover; daily and weekly views are a change of
period, not a new model.

## 7. Spending pace and historical comparison

*Essential. Anxiety it reduces: "I don't know whether my current spending is
normal or dangerous."*

Compare current spending with the user's own past months at equivalent points in
the month.

Must include:

- Typical, low and high historical spending.
- Current spending pace.
- Projected month-end spending.
- Separation of recurring expenses and unusual one-offs.

Example: *"You're on track to spend ₹6,000 more than your typical month."*

Needs: the summary tables of M5 and at least a couple of months of history. The
comparison is against the user's own past, never against anyone else, which
keeps the app offline-friendly and free of judgement.

## 8. What-if financial simulator

*Essential. Anxiety it reduces: "I don't know what will happen if I make a big
purchase or face an unexpected expense."*

Simulate financial decisions without changing real records.

Must include:

- Add a hypothetical expense or income change.
- Compare current and alternative scenarios.
- Show effects on cash balance, bills, emergency reserves and goals.
- Reset scenarios without affecting actual transactions.

Example: *"If you buy a ₹20,000 phone now, your projected month-end balance falls
to ₹8,000."*

Needs: the dashboard model from M5 as a pure function, so a scenario is a
different input rather than a different database. This is the cheapest of the
ten once M5 exists, and it unlocks #4.

## 9. Quick transaction capture and reconciliation

*Essential. Anxiety it reduces: "My numbers are probably wrong because I
haven't tracked everything."*

Make it easy to enter, import, categorise and correct transactions. The
forecast is only reassuring if the data behind it is reasonably accurate.

Must include:

- Fast manual entry.
- Recurring transaction rules and optional supported imports.
- Duplicate detection and transaction editing.
- A clear indication of when balances were last updated.

Example: *"Your forecast is based on transactions updated through today. Two
imported transactions need review."*

Status: mostly done in M3 and M4 — the SMS import, the manual promote
(`promoteEvent`), the edit drawer, the cross-source dedupe and the review queue
all exist. Still missing: a proper quick-entry form for a transaction that
never arrived as a notification, and the "updated through" stamp that the
forecast needs.

## 10. Financial recovery plan

*Essential. Anxiety it reduces: "I've already messed up my budget. I don't know
how to recover."*

When the user overspends or falls behind on a goal, give a deterministic
recovery plan based on their actual numbers, without shame or punitive alerts.

Must include:

- The size of the shortfall.
- Which upcoming commitments are affected.
- Realistic adjustments to discretionary spending or goal contributions.
- A revised date for returning to the planned budget.

Example: *"You're ₹2,000 over budget. Reducing discretionary spending by ₹500
per week gets you back on track in four weeks."*

Needs: budgets (#6), goals (#4) and the simulator (#8). The tone is part of the
requirement: the plan states what to do next, it never scolds.

---

## New data model these features need

| Table | Purpose | Needed by |
| --- | --- | --- |
| `commitments` | known bills, EMIs and subscriptions with due dates | #1, #2, #3, #10 |
| `goals` | savings targets, contributions and priorities | #1, #4, #8, #10 |
| `budgets` (planned) | category limits per period | #6, #10 |
| `daily_summaries` (planned) | cached aggregates per day per account | #7, #8 |
| settings: `buffer_minor`, `income_day` | reserve and payday | #1, #2, #5 |
| settings: `essential_categories` | which categories count as essential | #5 |
