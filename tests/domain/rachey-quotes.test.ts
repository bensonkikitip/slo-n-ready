import { pickRacheyLine, RACHEY_MOMENTS, RACHEY_QUOTES } from '../../src/domain/rachey-quotes';

const VALID_POSES = new Set([
  'mug', 'laptop', 'piggyBank', 'waving', 'writing', 'receipt',
  'phoneDollar', 'meditating', 'dreaming', 'books', 'watering',
  'budgetGoals', 'box', 'coin', 'sleeping', 'thumbsUp',
]);

describe('rachey-quotes', () => {
  it('every moment returns a non-empty line', () => {
    for (const moment of RACHEY_MOMENTS) {
      const { line } = pickRacheyLine(moment);
      expect(line.length).toBeGreaterThan(0);
    }
  });

  it('every moment uses a valid SlothKey pose', () => {
    for (const moment of RACHEY_MOMENTS) {
      const { pose } = RACHEY_QUOTES[moment];
      expect(VALID_POSES.has(pose)).toBe(true);
    }
  });

  it('all 50 lines across the pool are unique strings', () => {
    const all = Object.values(RACHEY_QUOTES).flatMap(e => e.lines);
    const unique = new Set(all);
    expect(unique.size).toBe(50);
  });

  it('every moment has at least 3 lines for variety', () => {
    for (const moment of RACHEY_MOMENTS) {
      expect(RACHEY_QUOTES[moment].lines.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('pickRacheyLine always returns a line from the correct moment pool', () => {
    for (const moment of RACHEY_MOMENTS) {
      const { line } = pickRacheyLine(moment);
      expect(RACHEY_QUOTES[moment].lines).toContain(line);
    }
  });
});
