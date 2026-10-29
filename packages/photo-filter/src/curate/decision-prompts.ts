import type { Question } from './decisions.js';

/** Bump when decision questions or scoring change; cached verdicts from other versions are ignored. */
export const DECISION_PROMPT_VERSION = 2;

export const QUALITY_CRITERIA = [
  'Unusable: badly blurred, too dark, or nothing recognisable',
  'Weak: soft focus, eyes closed, awkward crop, or subject hard to see',
  'Fine: clear but ordinary snapshot',
  'Good: sharp, well framed, nice expression',
  'Keeper: a standout moment worth printing or framing',
];

/** Special-moment criteria shown to the model (widened to cover school celebrations). */
export function specialInstructions(subjectText: string): string {
  return (
    `The photo to judge captures one of the most special moments of the period for ${subjectText}: ` +
    'being together with a parent, being at a special place, getting a special present, ' +
    'or a celebration or performance (school show, holiday, birthday party).'
  );
}

export function judgeQuestions(subjectText: string): Record<string, Question> {
  return {
    subject: {
      type: 'noul',
      instructions: `The photo to judge clearly shows ${subjectText}.`,
      criteria: { true: `${subjectText} is clearly visible`, false: `${subjectText} is absent or not recognisable` },
    },
    special: { type: 'noul', instructions: specialInstructions(subjectText) },
    quality: { type: 'score', instructions: 'How good is the photo to judge as a family keepsake?', criteria: QUALITY_CRITERIA },
  };
}

export function specialCompareInstructions(subjectText: string): string {
  return (
    `Which photo captures the most special moment for ${subjectText}: being with a parent, ` +
    'being at a special place, getting a special present, or a celebration or performance ' +
    '(school show, holiday, birthday party)? If tied, prefer the better photo.'
  );
}

export function burstCompareInstructions(): string {
  return 'These are near-duplicate shots. Which one is the best to keep (most special moment, then sharpest, best expression and framing)?';
}
