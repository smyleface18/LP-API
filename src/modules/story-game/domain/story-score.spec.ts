import { Correction, LanguageReview } from '@/modules/language-review/language-review.types';
import { calculatePanelScore } from './story-score';
import { PanelDraft } from './story-game.types';

// 10 palabras: cada error resta 3 × 1/10 = 30 % de precisión.
const TEXT = 'one two three four five six seven eight nine ten';

const correction: Correction = {
  original: 'two',
  suggestion: 'too',
  type: 'spelling',
  explanation: 'Ortografía.',
};

function reviewed(errors: number, text = TEXT): PanelDraft {
  const review: LanguageReview = {
    correctedText: text,
    corrections: Array.from({ length: errors }, () => correction),
    characterCorrections: [],
    flagged: false,
  };
  return { text, scene: 's', characterIds: [], newCharacters: [], review };
}

const unreviewed = (): PanelDraft => ({
  text: TEXT,
  scene: 's',
  characterIds: [],
  newCharacters: [],
  review: null,
});

describe('calculatePanelScore', () => {
  it('perfect on the first try: 100 accuracy + 50', () => {
    expect(calculatePanelScore([reviewed(0)], 'player')).toEqual({
      accuracy: 100,
      firstTryBonus: 50,
      selfCorrectionBonus: 0,
      timeoutPenalty: false,
      total: 150,
    });
  });

  it('self-correction: the second review has fewer errors than the first', () => {
    // 1 error en 10 palabras → 70.
    expect(calculatePanelScore([reviewed(2), reviewed(1)], 'player')).toEqual({
      accuracy: 70,
      firstTryBonus: 0,
      selfCorrectionBonus: 25,
      timeoutPenalty: false,
      total: 95,
    });
  });

  it('no self-correction bonus when the second review is not better', () => {
    expect(calculatePanelScore([reviewed(1), reviewed(1)], 'player').selfCorrectionBonus).toBe(0);
  });

  it('uses the errors of the LAST review for accuracy', () => {
    expect(calculatePanelScore([reviewed(0), reviewed(2)], 'player')).toMatchObject({
      accuracy: 40,
      firstTryBonus: 50,
      total: 90,
    });
  });

  it('accuracy never goes below 0', () => {
    expect(calculatePanelScore([reviewed(5)], 'player')).toMatchObject({ accuracy: 0, total: 0 });
  });

  it('timeout: accuracy counts half, bonuses stay', () => {
    expect(calculatePanelScore([reviewed(1)], 'timeout')).toEqual({
      accuracy: 70,
      firstTryBonus: 0,
      selfCorrectionBonus: 0,
      timeoutPenalty: true,
      total: 35,
    });
    expect(calculatePanelScore([reviewed(0)], 'timeout').total).toBe(50 + 50);
  });

  it('no text: the turn ran out without drafts', () => {
    expect(calculatePanelScore([], 'timeout')).toEqual({
      accuracy: 0,
      firstTryBonus: 0,
      selfCorrectionBonus: 0,
      timeoutPenalty: true,
      total: 0,
    });
  });

  it('AI down: a fixed 60 when the final text could not be reviewed', () => {
    const expected = {
      accuracy: 60,
      firstTryBonus: 0,
      selfCorrectionBonus: 0,
      timeoutPenalty: false,
      total: 60,
    };
    expect(calculatePanelScore([unreviewed()], 'player')).toEqual(expected);
    // También confirmada por timeout, y aunque antes hubiera una revisión.
    expect(calculatePanelScore([reviewed(3), unreviewed()], 'timeout')).toEqual(expected);
  });

  it('counts revisions only among reviewed drafts', () => {
    // Revisión 1 = primer borrador revisado (el anterior no se pudo revisar).
    expect(calculatePanelScore([unreviewed(), reviewed(0)], 'player')).toMatchObject({
      firstTryBonus: 50,
      total: 150,
    });
  });

  it('rounds accuracy', () => {
    // 1 error en 7 palabras → 100 × (1 − 3/7) = 57.14 → 57; timeout → 28.5 → 29.
    const seven = 'one two three four five six seven';
    expect(calculatePanelScore([reviewed(1, seven)], 'player').accuracy).toBe(57);
    expect(calculatePanelScore([reviewed(1, seven)], 'timeout').total).toBe(29);
  });
});
