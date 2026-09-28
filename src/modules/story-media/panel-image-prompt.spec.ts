import { buildPanelImagePrompt, PANEL_STYLE, seedForGame } from './panel-image-prompt';
import {
  IMAGE_PROMPT_MAX_CHARS,
  PROMPT_MAX_CHARACTERS,
  PROMPT_MAX_SCENE_CHARS,
} from './story-media.config';

describe('buildPanelImagePrompt', () => {
  const input = {
    seed: 1,
    scene: 'A dark   forest at night',
    text: 'Max walked into the forest to find Luna.',
    characters: [
      { name: 'Max', kind: 'robot', description: 'small silver robot with blue eyes' },
      { name: 'Luna', kind: 'cat', description: 'black cat with a white spot' },
    ],
  };

  /** Viñeta con todo al máximo que permite el borrador (escenario 200, fichas 30/30/100). */
  const longest = {
    seed: 1,
    scene: 's'.repeat(200),
    text: 'word '.repeat(64).trim(),
    characters: [1, 2, 3].map((i) => ({
      name: `${i}`.repeat(30),
      kind: 'k'.repeat(30),
      description: `${'d'.repeat(99)}${i}`,
    })),
  };

  it('describes the style, the scene, every character and the action', () => {
    const prompt = buildPanelImagePrompt(input);
    expect(prompt.startsWith(PANEL_STYLE)).toBe(true);
    expect(prompt).toContain('Setting: A dark forest at night.');
    expect(prompt).toContain('Max is a robot: small silver robot with blue eyes');
    expect(prompt).toContain('Luna is a cat: black cat with a white spot');
    expect(prompt).toContain('Action: Max walked into the forest to find Luna.');
  });

  it('asks for a wordless illustration, without text or speech bubbles', () => {
    expect(buildPanelImagePrompt(input)).toContain(
      'wordless illustration, no text, no speech bubbles',
    );
  });

  it('works without characters', () => {
    const prompt = buildPanelImagePrompt({ ...input, characters: [] });
    expect(prompt).not.toContain('Characters:');
    expect(prompt).toContain('Action:');
  });

  it('never cuts the character sheets: only the action is cut to fit the limit', () => {
    const prompt = buildPanelImagePrompt(longest);

    expect(prompt.length).toBeLessThanOrEqual(IMAGE_PROMPT_MAX_CHARS);
    expect(prompt).toContain(`Setting: ${longest.scene}.`);
    for (const { name, kind, description } of longest.characters) {
      expect(prompt).toContain(`${name} is a ${kind}: ${description}`);
    }
    // A la acción le queda lugar aunque todo lo demás esté al máximo.
    const action = prompt.slice(prompt.indexOf('Action: '));
    expect(action.length).toBeGreaterThanOrEqual(100);
    expect(action.endsWith('…')).toBe(true);
  });

  it('caps a longer scene or sheet instead of cutting the ones after it', () => {
    const prompt = buildPanelImagePrompt({
      ...longest,
      scene: 'x'.repeat(500),
      characters: [
        { ...longest.characters[0], description: 'y'.repeat(500) },
        ...longest.characters.slice(1),
      ],
    });

    expect(prompt.length).toBeLessThanOrEqual(IMAGE_PROMPT_MAX_CHARS);
    expect(prompt).toContain(`Setting: ${'x'.repeat(PROMPT_MAX_SCENE_CHARS - 1)}….`);
    const [, second, third] = longest.characters;
    expect(prompt).toContain(`${second.name} is a ${second.kind}: ${second.description}`);
    expect(prompt).toContain(`${third.name} is a ${third.kind}: ${third.description}`);
  });

  it(`describes at most ${PROMPT_MAX_CHARACTERS} characters`, () => {
    const prompt = buildPanelImagePrompt({
      ...input,
      characters: [1, 2, 3, 4].map((i) => ({ name: `C${i}`, kind: 'cat', description: 'd' })),
    });
    expect(prompt).toContain('C3 is a cat');
    expect(prompt).not.toContain('C4');
  });
});

describe('seedForGame', () => {
  it('is stable for a game and inside the 0..858993459 range', () => {
    const seed = seedForGame('3f2b8a3e-1c7d-4a5e-9f00-1234567890ab');
    expect(seed).toBe(seedForGame('3f2b8a3e-1c7d-4a5e-9f00-1234567890ab'));
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(858_993_459);
    expect(seedForGame('another-game')).not.toBe(seed);
  });
});
