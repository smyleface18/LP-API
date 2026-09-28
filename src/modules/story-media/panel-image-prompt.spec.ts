import { buildPanelImagePrompt, seedForStory } from './panel-image-prompt';
import { IMAGE_PROMPT_MAX_CHARS } from './story-media.config';

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

  it('describes the style, the scene, every character and the action', () => {
    const prompt = buildPanelImagePrompt(input);
    expect(prompt).toContain("Children's comic book panel");
    expect(prompt).toContain('Setting: A dark forest at night.');
    expect(prompt).toContain('Max is a robot: small silver robot with blue eyes');
    expect(prompt).toContain('Luna is a cat: black cat with a white spot');
    expect(prompt).toContain('Action: Max walked into the forest to find Luna.');
  });

  it('works without characters', () => {
    const prompt = buildPanelImagePrompt({ ...input, characters: [] });
    expect(prompt).not.toContain('Characters:');
    expect(prompt).toContain('Action:');
  });

  it('never goes over the Nova Canvas limit, cutting the action first', () => {
    const prompt = buildPanelImagePrompt({ ...input, text: 'word '.repeat(400) });
    expect(prompt.length).toBeLessThanOrEqual(IMAGE_PROMPT_MAX_CHARS);
    expect(prompt).toContain('Luna is a cat');
  });
});

describe('seedForStory', () => {
  it('is stable for a story and inside the Nova Canvas range', () => {
    const seed = seedForStory('3f2b8a3e-1c7d-4a5e-9f00-1234567890ab');
    expect(seed).toBe(seedForStory('3f2b8a3e-1c7d-4a5e-9f00-1234567890ab'));
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(858_993_459);
    expect(seedForStory('another-story')).not.toBe(seed);
  });
});
