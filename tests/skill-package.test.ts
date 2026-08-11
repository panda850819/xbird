import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SKILL_FRONTMATTER_REGEX = /^---\nname: xbird\n/m;
const root = fileURLToPath(new URL('..', import.meta.url));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  files?: string[];
  bin?: Record<string, string>;
  pi?: { skills?: string[] };
};

describe('xbird agent skill package', () => {
  it('publishes and registers the skills directory', () => {
    expect(packageJson.files).toContain('src');
    expect(packageJson.files).toContain('skills');
    expect(packageJson.bin?.xbird).toBe('src/cli.ts');
    expect(packageJson.pi?.skills).toContain('./skills');
  });

  it('provides a valid xbird skill and library reference', () => {
    const skill = fs.readFileSync(path.join(root, 'skills', 'xbird', 'SKILL.md'), 'utf8');

    expect(skill).toMatch(SKILL_FRONTMATTER_REGEX);
    expect(skill).toContain('description:');
    expect(skill).toContain('references/library.md');
    expect(fs.existsSync(path.join(root, 'skills', 'xbird', 'references', 'library.md'))).toBe(true);
  });
});
