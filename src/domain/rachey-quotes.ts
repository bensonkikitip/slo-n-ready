import { SlothKey } from '../components/Sloth';

export type RacheyMoment =
  | 'noAccounts'
  | 'firstAccount'
  | 'noTransactions'
  | 'firstImport'
  | 'recurringImport'
  | 'noCategories'
  | 'firstCategory'
  | 'noRules'
  | 'firstRule'
  | 'firstTransactionCategorized'
  | 'bulkCategorize'
  | 'firstBudget'
  | 'firstBackup'
  | 'recurringBackup'
  | 'milestone100Tx';

interface RacheyEntry { pose: SlothKey; lines: string[] }

export const RACHEY_QUOTES: Record<RacheyMoment, RacheyEntry> = {
  noAccounts: {
    pose: 'dreaming',
    lines: [
      "Welcome to the tree. We'll take it leaf by leaf.",
      "Slo & Ready when you are. There's no wrong pace.",
      "No rush. Money stuff is calmer up here on the branch.",
      "Hello there. Glad you climbed up.",
      "Welcome. The leaves are quiet here.",
      "Take it slow. We'll go together.",
    ],
  },
  firstAccount: {
    pose: 'laptop',
    lines: [
      "Hi, I'm Rachey. I move slow, but I'm great with money.",
      "Settle in. You picked the right tree.",
      "First time? Same. Let's see what we're working with.",
      "You made it. That's already the win.",
    ],
  },
  noTransactions: {
    pose: 'receipt',
    lines: [
      "Welcome. The leaves are quiet here.",
      "Hang in there — literally how I survive.",
      "You did the hard part: looking. The rest is just leaves.",
      "Take a breath. The numbers will wait.",
      "Nothing's on fire. Just numbers.",
    ],
  },
  firstImport: {
    pose: 'phoneDollar',
    lines: [
      "Look at you go. Slowly. Beautifully.",
      "One leaf at a time. You're doing great.",
      "Tiny moves, real progress.",
      "The pace is the point.",
      "Slowly chipping away. Right move.",
    ],
  },
  recurringImport: {
    pose: 'coin',
    lines: [
      "Look at you go. Slowly. Beautifully.",
      "One leaf at a time. You're doing great.",
      "Slow and steady wins the budget.",
      "Another step up the branch.",
      "You're showing up. That's the whole secret.",
      "Steady wins. Always has.",
      "Every transaction has a home now. Ahhh.",
      "Neatly stacked. Like a good pile of leaves.",
    ],
  },
  noCategories: {
    pose: 'writing',
    lines: [
      "Knowing where it goes is half the battle.",
      "Awareness is the whole game.",
      "You can't fix what you can't see. You're seeing it now.",
    ],
  },
  firstCategory: {
    pose: 'writing',
    lines: [
      "Categorized. Treat yourself to a leaf.",
      "Sorted with care.",
      "There — everything where it belongs.",
    ],
  },
  noRules: {
    pose: 'books',
    lines: [
      "Slow and steady wins the budget.",
      "Knowing where it goes is half the battle.",
      "You can't fix what you can't see. You're seeing it now.",
      "Money's just data. You're in charge.",
    ],
  },
  firstRule: {
    pose: 'books',
    lines: [
      "Categorized. Treat yourself to a leaf.",
      "Neatly stacked. Like a good pile of leaves.",
      "Knowing where it goes is half the battle.",
      "Awareness is the whole game.",
    ],
  },
  firstTransactionCategorized: {
    pose: 'thumbsUp',
    lines: [
      "All sorted out. Naptime worthy.",
      "Even my claws are impressed.",
      "Tidy money, tidy mind.",
      "Clean lists are good for the soul.",
    ],
  },
  bulkCategorize: {
    pose: 'thumbsUp',
    lines: [
      "All sorted out. Naptime worthy.",
      "Even my claws are impressed.",
      "Categorized. Treat yourself to a leaf.",
      "Every transaction has a home now. Ahhh.",
      "Neatly stacked. Like a good pile of leaves.",
      "Order, restored. Slowly.",
      "Sorted with care.",
      "There — everything where it belongs.",
      "Clean lists are good for the soul.",
    ],
  },
  firstBudget: {
    pose: 'budgetGoals',
    lines: [
      "First budget set. Look at us, planning.",
      "You're officially in the rhythm.",
      "Big moment. Small smile.",
      "Tomorrow-you will thank today-you.",
    ],
  },
  firstBackup: {
    pose: 'meditating',
    lines: [
      "No rush. Money stuff is calmer up here on the branch.",
      "Money worries get smaller when you can see them.",
      "Take a breath. The numbers will wait.",
      "This is how it gets better — one small look at a time.",
    ],
  },
  recurringBackup: {
    pose: 'meditating',
    lines: [
      "Money worries get smaller when you can see them.",
      "Take a breath. The numbers will wait.",
      "Nothing's on fire. Just numbers.",
      "This is how it gets better — one small look at a time.",
    ],
  },
  milestone100Tx: {
    pose: 'waving',
    lines: [
      "100 transactions in. The tree is proud.",
      "You showed up. Most sloths can't say that.",
      "Slow streak, strong streak.",
      "Milestone. Quietly earned.",
      "Look how far you've come, leaf by leaf.",
      "That's a whole forest of progress.",
      "The receipts say you've been busy.",
    ],
  },
};

export const RACHEY_MOMENTS = Object.keys(RACHEY_QUOTES) as RacheyMoment[];

export function pickRacheyLine(moment: RacheyMoment): { pose: SlothKey; line: string } {
  const { pose, lines } = RACHEY_QUOTES[moment];
  return { pose, line: lines[Math.floor(Math.random() * lines.length)] };
}
