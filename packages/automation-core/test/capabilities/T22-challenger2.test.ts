// packages/automation-core/test/capabilities/T22-challenger2.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import type { Snapshot } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import '../../src/index';
import {
  marketplaceBrowseOperation,
  marketplaceImportOperation,
  marketplacePublishListingOperation,
  ASSET_SHARE_URL_REGEX,
  LISTINGS_STORAGE_PATH,
} from '../../src/operations/marketplace';
import {
  skillsListOperation,
  skillsSaveOperation,
  SKILL_NAME_REGEX,
} from '../../src/operations/project-skills';
import { projectFS } from '@/code/project/project-fs';
import { checkFile } from '@/code/oracle/check-file';
import {
  SKILLS_FILE_PATH,
  SKILL_CONTENT_MAX,
  MAX_SKILLS,
} from '@/code/project/skills-config';

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function createMockSnapshot(files: Record<string, string>, revision = 1): Snapshot {
  return createSnapshot({ projectId: 'test-project', branchId: 'main' }, revision, files);
}

describe('Challenger 2 Empirical Stress Harness: Milestone T22 Integrity', () => {
  const context = createOperationContext();

  beforeEach(() => {
    projectFS.loadSnapshot(new Map());
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Stress-test marketplace.import
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. marketplace.import — URL Boundaries, Security & Oracle Invariants', () => {
    it('rejects URLs with trailing slashes', async () => {
      const snap = createMockSnapshot({});
      const trailingSlashUrls = [
        'https://assets.revyme.app/components/HeroSection@a1b2c3d4e5f6.js/',
        'https://assets.revyme.app/vectors/FeatherIcons@f6a1b2c3d4e5.js/',
        'https://assets.revyme.app/components/HeroSection@a1b2c3d4e5f6.js///',
      ];

      for (const url of trailingSlashUrls) {
        expect(ASSET_SHARE_URL_REGEX.test(url), `Regex should reject trailing slash: ${url}`).toBe(false);
        await expect(
          marketplaceImportOperation.execute(snap, { url }, context),
          `marketplace.import should throw on trailing slash: ${url}`,
        ).rejects.toThrow();
      }
    });

    it('rejects invalid domains, subdomains, and protocols', async () => {
      const snap = createMockSnapshot({});
      const badDomainUrls = [
        'https://evil.assets.revyme.app/components/HeroSection@a1b2c3d4e5f6.js',
        'https://assets.revyme.app.attacker.com/components/HeroSection@a1b2c3d4e5f6.js',
        'http://assets.revyme.app/components/HeroSection@a1b2c3d4e5f6.js',
        'ftp://assets.revyme.app/components/HeroSection@a1b2c3d4e5f6.js',
        'https://revyme.app/components/HeroSection@a1b2c3d4e5f6.js',
        'https://assets.revyme.io/components/HeroSection@a1b2c3d4e5f6.js',
      ];

      for (const url of badDomainUrls) {
        expect(ASSET_SHARE_URL_REGEX.test(url), `Regex should reject invalid domain: ${url}`).toBe(false);
        await expect(
          marketplaceImportOperation.execute(snap, { url }, context),
          `marketplace.import should reject domain: ${url}`,
        ).rejects.toThrow();
      }
    });

    it('rejects query parameters and hash fragments', async () => {
      const snap = createMockSnapshot({});
      const parameterUrls = [
        'https://assets.revyme.app/components/HeroSection@a1b2c3d4e5f6.js?version=latest',
        'https://assets.revyme.app/components/HeroSection@a1b2c3d4e5f6.js?v=2&auth=true',
        'https://assets.revyme.app/components/HeroSection@a1b2c3d4e5f6.js#section',
        'https://assets.revyme.app/vectors/FeatherIcons@f6a1b2c3d4e5.js?cache=false',
      ];

      for (const url of parameterUrls) {
        expect(ASSET_SHARE_URL_REGEX.test(url), `Regex should reject query or hash: ${url}`).toBe(false);
        await expect(
          marketplaceImportOperation.execute(snap, { url }, context),
          `marketplace.import should reject query or hash: ${url}`,
        ).rejects.toThrow();
      }
    });

    it('rejects uppercase and mixed-case version hashes (canonical lowercase hex required)', async () => {
      const snap = createMockSnapshot({});
      const upperCaseUrls = [
        'https://assets.revyme.app/components/HeroSection@A1B2C3D4E5F6.js',
        'https://assets.revyme.app/vectors/FeatherIcons@F6A1B2C3D4E5.js',
        'https://assets.revyme.app/components/HeroSection@a1B2c3D4e5F6.js',
      ];

      for (const url of upperCaseUrls) {
        expect(ASSET_SHARE_URL_REGEX.test(url), `Regex should reject non-lowercase hash: ${url}`).toBe(false);
        await expect(
          marketplaceImportOperation.execute(snap, { url }, context),
          `marketplace.import should reject uppercase hash: ${url}`,
        ).rejects.toThrow();
      }
    });

    it('rejects path traversal in URL and targetPath', async () => {
      const snap = createMockSnapshot({});
      const traversalUrls = [
        'https://assets.revyme.app/components/../HeroSection@a1b2c3d4e5f6.js',
        'https://assets.revyme.app/components/%2e%2e/HeroSection@a1b2c3d4e5f6.js',
        'https://assets.revyme.app/components/sub/HeroSection@a1b2c3d4e5f6.js',
      ];

      for (const url of traversalUrls) {
        expect(ASSET_SHARE_URL_REGEX.test(url), `Regex should reject traversal URL: ${url}`).toBe(false);
        await expect(
          marketplaceImportOperation.execute(snap, { url }, context),
        ).rejects.toThrow();
      }

      const validUrl = 'https://assets.revyme.app/components/HeroSection@a1b2c3d4e5f6.js';
      const maliciousTargetPaths = [
        '../evil.tsx',
        'components/../../etc/passwd.tsx',
        '/root/secret.tsx',
        'components/sub/\0null.tsx',
      ];

      for (const targetPath of maliciousTargetPaths) {
        await expect(
          marketplaceImportOperation.execute(snap, { url: validUrl, targetPath }, context),
          `marketplace.import should block malicious targetPath "${targetPath}"`,
        ).rejects.toThrow(/SECURITY_ERROR/i);
      }
    });

    it('rejects non-supported asset kinds (templates and plugins)', async () => {
      const snap = createMockSnapshot({});
      const unsupportedKindUrls = [
        'https://assets.revyme.app/templates/AgencyPortfolio@3c4d5e6f1a2b.js',
        'https://assets.revyme.app/plugins/DirectusSync@9a8b7c6d5e4f.js',
        'https://assets.revyme.app/icons/FeatherIcons@f6a1b2c3d4e5.js',
      ];

      for (const url of unsupportedKindUrls) {
        expect(ASSET_SHARE_URL_REGEX.test(url), `Regex should reject unsupported category: ${url}`).toBe(false);
        await expect(
          marketplaceImportOperation.execute(snap, { url }, context),
        ).rejects.toThrow();
      }
    });

    it('generates remote component proxy with ZERO Oracle tier 3 or tier 1 blockers', async () => {
      const snap = createMockSnapshot({});
      const componentUrl = 'https://assets.revyme.app/components/PricingTable@b2c3d4e5f6a1.js';

      const res = await marketplaceImportOperation.execute(snap, { url: componentUrl }, context);
      expect(res.componentName).toBe('PricingTable');
      expect(res.localPath).toBe('components/remote/PricingTable.tsx');

      const generatedCode = projectFS.readFile('components/remote/PricingTable.tsx');
      expect(generatedCode).toBeDefined();

      const violations = checkFile(generatedCode!, {
        kind: 'code-component',
        path: res.localPath,
      });

      const tier3Blockers = violations.filter((v) => v.tier === 3);
      const tier1Syntax = violations.filter((v) => v.tier === 1);
      const tier2Dialect = violations.filter((v) => v.tier === 2);

      expect(tier3Blockers, 'Should produce 0 tier 3 Oracle blockers for component proxy').toHaveLength(0);
      expect(tier1Syntax, 'Should produce 0 tier 1 syntax errors for component proxy').toHaveLength(0);
      expect(tier2Dialect, 'Should produce 0 tier 2 dialect violations for component proxy').toHaveLength(0);
      expect(violations, 'Component proxy should be 100% clean under checkFile').toHaveLength(0);
    });

    it('generates remote vector proxy with ZERO Oracle tier 3 or tier 1 blockers', async () => {
      const snap = createMockSnapshot({});
      const vectorUrl = 'https://assets.revyme.app/vectors/LucideSet@1a2b3c4d5e6f.js';

      const res = await marketplaceImportOperation.execute(snap, { url: vectorUrl }, context);
      expect(res.componentName).toBe('LucideSet');
      expect(res.localPath).toBe('components/remote/LucideSet.tsx');

      const generatedCode = projectFS.readFile('components/remote/LucideSet.tsx');
      expect(generatedCode).toBeDefined();

      const violations = checkFile(generatedCode!, {
        kind: 'code-component',
        path: res.localPath,
      });

      const tier3Blockers = violations.filter((v) => v.tier === 3);
      const tier1Syntax = violations.filter((v) => v.tier === 1);
      const tier2Dialect = violations.filter((v) => v.tier === 2);

      expect(tier3Blockers, 'Should produce 0 tier 3 Oracle blockers for vector proxy').toHaveLength(0);
      expect(tier1Syntax, 'Should produce 0 tier 1 syntax errors for vector proxy').toHaveLength(0);
      expect(tier2Dialect, 'Should produce 0 tier 2 dialect violations for vector proxy').toHaveLength(0);
      expect(violations, 'Vector proxy should be 100% clean under checkFile').toHaveLength(0);
    });

    it('auto-appends .tsx extension to custom targetPath without .tsx', async () => {
      const snap = createMockSnapshot({});
      const componentUrl = 'https://assets.revyme.app/components/HeroSection@a1b2c3d4e5f6.js';

      const res = await marketplaceImportOperation.execute(
        snap,
        { url: componentUrl, targetPath: 'components/custom/CustomHero' },
        context,
      );

      expect(res.localPath).toBe('components/custom/CustomHero.tsx');
      expect(projectFS.exists('components/custom/CustomHero.tsx')).toBe(true);

      const code = projectFS.readFile('components/custom/CustomHero.tsx');
      const violations = checkFile(code!, { kind: 'code-component', path: res.localPath });
      expect(violations.filter((v) => v.tier === 3)).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Stress-test marketplace.publishListing
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. marketplace.publishListing — Validation, Pricing & Status Transitions', () => {
    it('throws when target file is missing or path points to a directory', async () => {
      const snap = createMockSnapshot({
        'components/ValidComp.tsx': `'use client'; export default function ValidComp() { return <div data-id="root" />; }`,
      });

      // Missing file
      await expect(
        marketplacePublishListingOperation.execute(
          snap,
          { path: 'components/NonExistent.tsx', name: 'NonExistent' },
          context,
        ),
      ).rejects.toThrow(/File not found: components\/NonExistent\.tsx/i);

      // Directory path with trailing slash
      await expect(
        marketplacePublishListingOperation.execute(
          snap,
          { path: 'components/', name: 'ComponentsDir' },
          context,
        ),
      ).rejects.toThrow(/File not found: components\//i);

      // Directory path without trailing slash
      await expect(
        marketplacePublishListingOperation.execute(
          snap,
          { path: 'components', name: 'ComponentsDir' },
          context,
        ),
      ).rejects.toThrow(/File not found: components/i);

      // Root path '.'
      await expect(
        marketplacePublishListingOperation.execute(
          snap,
          { path: '.', name: 'RootDir' },
          context,
        ),
      ).rejects.toThrow(/File not found: \./i);

      // Empty path
      await expect(
        marketplacePublishListingOperation.execute(
          snap,
          { path: '', name: 'EmptyPath' },
          context,
        ),
      ).rejects.toThrow(/Path must not be empty/i);
    });

    it('rejects paid listings with priceCents <= 0, float priceCents, or missing price', async () => {
      const snap = createMockSnapshot({
        'components/PaidItem.tsx': `'use client'; export default function PaidItem() { return <div data-id="root" />; }`,
      });

      // Missing priceCents
      await expect(
        marketplacePublishListingOperation.execute(
          snap,
          { path: 'components/PaidItem.tsx', name: 'PaidItem', pricingType: 'paid' },
          context,
        ),
      ).rejects.toThrow(/VALIDATION_ERROR: Paid listings require a positive price in cents/i);

      // priceCents = 0
      await expect(
        marketplacePublishListingOperation.execute(
          snap,
          { path: 'components/PaidItem.tsx', name: 'PaidItem', pricingType: 'paid', priceCents: 0 },
          context,
        ),
      ).rejects.toThrow(/VALIDATION_ERROR: Paid listings require a positive price in cents/i);

      // Negative priceCents
      await expect(
        marketplacePublishListingOperation.execute(
          snap,
          { path: 'components/PaidItem.tsx', name: 'PaidItem', pricingType: 'paid', priceCents: -500 },
          context,
        ),
      ).rejects.toThrow(/too_small|expected number to be >=0|greater than or equal/i);

      // Floating point priceCents
      await expect(
        marketplacePublishListingOperation.execute(
          snap,
          { path: 'components/PaidItem.tsx', name: 'PaidItem', pricingType: 'paid', priceCents: 19.99 },
          context,
        ),
      ).rejects.toThrow(/integer|float|expected int/i);

      // Free listing with priceCents 0 or omitted succeeds
      const freeRes1 = await marketplacePublishListingOperation.execute(
        snap,
        { path: 'components/PaidItem.tsx', name: 'FreeItem1', pricingType: 'free' },
        context,
      );
      expect(freeRes1.status).toBe('draft');

      const freeRes2 = await marketplacePublishListingOperation.execute(
        snap,
        { path: 'components/PaidItem.tsx', name: 'FreeItem2', pricingType: 'free', priceCents: 0 },
        context,
      );
      expect(freeRes2.status).toBe('draft');

      // Valid paid listing succeeds
      const paidRes = await marketplacePublishListingOperation.execute(
        snap,
        { path: 'components/PaidItem.tsx', name: 'PaidItemOk', pricingType: 'paid', priceCents: 1500 },
        context,
      );
      expect(paidRes.status).toBe('draft');
    });

    it('enforces staging/review status transitions (draft vs pending) based on publish and thumbnailUrl', async () => {
      const snap = createMockSnapshot({
        'components/StageItem.tsx': `'use client'; export default function StageItem() { return <div data-id="root" />; }`,
      });

      // publish: false, without thumbnailUrl -> draft
      const r1 = await marketplacePublishListingOperation.execute(
        snap,
        { path: 'components/StageItem.tsx', name: 'Item1', publish: false },
        context,
      );
      expect(r1.status).toBe('draft');

      // publish: false, with thumbnailUrl -> draft
      const r2 = await marketplacePublishListingOperation.execute(
        snap,
        {
          path: 'components/StageItem.tsx',
          name: 'Item2',
          publish: false,
          thumbnailUrl: 'https://assets.revyme.app/thumbs/item2.png',
        },
        context,
      );
      expect(r2.status).toBe('draft');

      // publish: true, WITHOUT thumbnailUrl -> draft (requires thumbnail for review)
      const r3 = await marketplacePublishListingOperation.execute(
        snap,
        { path: 'components/StageItem.tsx', name: 'Item3', publish: true },
        context,
      );
      expect(r3.status).toBe('draft');

      // publish: true, WITH thumbnailUrl -> pending
      const r4 = await marketplacePublishListingOperation.execute(
        snap,
        {
          path: 'components/StageItem.tsx',
          name: 'Item4',
          publish: true,
          thumbnailUrl: 'https://assets.revyme.app/thumbs/item4.png',
        },
        context,
      );
      expect(r4.status).toBe('pending');

      // publish: true, with invalid thumbnailUrl -> throws schema error
      await expect(
        marketplacePublishListingOperation.execute(
          snap,
          {
            path: 'components/StageItem.tsx',
            name: 'Item5',
            publish: true,
            thumbnailUrl: 'not-a-valid-url',
          },
          context,
        ),
      ).rejects.toThrow(/Thumbnail must be a valid URL/i);
    });

    it('updates existing listing preserving id and createdAt while updating status to pending', async () => {
      const snap = createMockSnapshot({
        'components/UpdateItem.tsx': `'use client'; export default function UpdateItem() { return <div data-id="root" />; }`,
      });

      // 1. Initial creation as draft
      const initial = await marketplacePublishListingOperation.execute(
        snap,
        { path: 'components/UpdateItem.tsx', name: 'UpdateItem', publish: false },
        context,
      );
      expect(initial.action).toBe('created');
      expect(initial.status).toBe('draft');

      const storageAfterCreate = JSON.parse(projectFS.readFile(LISTINGS_STORAGE_PATH)!);
      const createdAt = storageAfterCreate[0].createdAt;
      expect(createdAt).toBeDefined();

      // 2. Update to pending by setting publish=true and thumbnailUrl
      const updated = await marketplacePublishListingOperation.execute(
        snap,
        {
          path: 'components/UpdateItem.tsx',
          name: 'UpdateItem',
          publish: true,
          thumbnailUrl: 'https://assets.revyme.app/thumbs/ready.png',
          description: 'Ready for review',
        },
        context,
      );
      expect(updated.action).toBe('updated');
      expect(updated.listingId).toBe(initial.listingId);
      expect(updated.status).toBe('pending');

      const storageAfterUpdate = JSON.parse(projectFS.readFile(LISTINGS_STORAGE_PATH)!);
      expect(storageAfterUpdate[0].id).toBe(initial.listingId);
      expect(storageAfterUpdate[0].createdAt).toBe(createdAt);
      expect(storageAfterUpdate[0].status).toBe('pending');
      expect(storageAfterUpdate[0].description).toBe('Ready for review');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Stress-test project-skills
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. project-skills — Frontmatter Parsing, Precedence & Boundaries', () => {
    it('parses Windows CRLF (\\r\\n) frontmatter line endings correctly', async () => {
      const crlfSkill = [
        '---',
        'name: crlf-tester',
        'description: Tested with Windows CRLF endings',
        'alwaysApply: true',
        '---',
        '# Header',
        'This is the body content with CRLF line 1',
        'Line 2 of rules',
      ].join('\r\n');

      const snap = createMockSnapshot({
        '.agents/skills/crlf-tester/SKILL.md': crlfSkill,
      });

      const res = await skillsListOperation.execute(snap, {}, context);
      const skill = res.skills.find((s) => s.name === 'crlf-tester');

      expect(skill).toBeDefined();
      expect(skill?.name).toBe('crlf-tester');
      expect(skill?.description).toBe('Tested with Windows CRLF endings');
      expect(skill?.alwaysApply).toBe(true);
      expect(skill?.charCount).toBeGreaterThan(20);
    });

    it('handles irregular frontmatter formatting: quotes, loose spacing, snake_case always_apply, extra colons', async () => {
      const irregularSkill = `---
   name   :   "loose-spacing"
   description   :   'Note: do not remove: colons in text'
   always_apply   :   "true"
---
# Rules
Follow loose format guidelines.
`;
      const snap = createMockSnapshot({
        '.agents/skills/loose-spacing/SKILL.md': irregularSkill,
      });

      const res = await skillsListOperation.execute(snap, {}, context);
      const skill = res.skills.find((s) => s.name === 'loose-spacing');

      expect(skill).toBeDefined();
      expect(skill?.name).toBe('loose-spacing');
      expect(skill?.description).toBe('Note: do not remove: colons in text');
      expect(skill?.alwaysApply).toBe(true);
    });

    it('infers missing fields gracefully (missing name, missing description, direct markdown without frontmatter)', async () => {
      // 1. Missing name in .agents/skills/inferred-folder/SKILL.md -> infers from directory
      const noNameSkill = `---
description: Inferred directory name
alwaysApply: false
---
Body text here.
`;
      // 2. Direct markdown file .agents/skills/direct-inferred.md without name
      const directNoName = `---
description: Direct inferred name
---
Direct body.
`;
      // 3. Missing description -> infers from first line of body
      const noDescSkill = `---
name: body-desc
alwaysApply: true
---
This first line of body should become the description.
Second line.
`;
      // 4. File without any frontmatter dashes
      const rawMarkdown = `# Pure Markdown Title
This skill has no frontmatter block at all.
`;

      const snap = createMockSnapshot({
        '.agents/skills/inferred-folder/SKILL.md': noNameSkill,
        '.agents/skills/direct-inferred.md': directNoName,
        '.agents/skills/body-desc/SKILL.md': noDescSkill,
        '.agents/skills/raw-notes.md': rawMarkdown,
      });

      const res = await skillsListOperation.execute(snap, {}, context);

      const s1 = res.skills.find((s) => s.name === 'inferred-folder');
      expect(s1).toBeDefined();
      expect(s1?.description).toBe('Inferred directory name');

      const s2 = res.skills.find((s) => s.name === 'direct-inferred');
      expect(s2).toBeDefined();
      expect(s2?.description).toBe('Direct inferred name');

      const s3 = res.skills.find((s) => s.name === 'body-desc');
      expect(s3).toBeDefined();
      expect(s3?.description).toContain('This first line of body should become the description');

      const s4 = res.skills.find((s) => s.name === 'raw-notes');
      expect(s4).toBeDefined();
      expect(s4?.description).toBe('# Pure Markdown Title');
      expect(s4?.alwaysApply).toBe(false);
    });

    it('enforces precedence: _meta/skills.json OVERRIDES .agents/skills/ definitions', async () => {
      const canonicalSkills = {
        version: 1,
        skills: [
          {
            name: 'brand-voice',
            description: 'Canonical description from _meta/skills.json',
            content: 'Canonical instructions from project file',
            alwaysApply: true,
            createdAt: 1000,
            updatedAt: 2000,
          },
        ],
      };

      const workspaceSkillMd = `---
name: brand-voice
description: Subservient description from .agents/skills/
alwaysApply: false
---
Subservient instructions in agent directory.
`;

      const snap = createMockSnapshot({
        [SKILLS_FILE_PATH]: JSON.stringify(canonicalSkills),
        '.agents/skills/brand-voice/SKILL.md': workspaceSkillMd,
      });

      const res = await skillsListOperation.execute(snap, {}, context);
      const matches = res.skills.filter((s) => s.name === 'brand-voice');

      // Must deduplicate to exactly one entry
      expect(matches).toHaveLength(1);
      // Canonical _meta/skills.json must win
      expect(matches[0].description).toBe('Canonical description from _meta/skills.json');
      expect(matches[0].alwaysApply).toBe(true);
      expect(matches[0].charCount).toBe('Canonical instructions from project file'.length);
    });

    it('boundary test: accepts content of exactly 8000 characters, rejects 8001 and empty body', async () => {
      const snap = createMockSnapshot({});

      // Exactly 8000 characters: valid
      const exactContent = 'x'.repeat(SKILL_CONTENT_MAX);
      const exactRes = await skillsSaveOperation.execute(
        snap,
        {
          name: 'exact-boundary',
          description: 'Boundary test at exactly 8000 chars',
          content: exactContent,
        },
        context,
      );
      expect(exactRes.name).toBe('exact-boundary');

      // 8001 characters: rejected
      const overContent = 'x'.repeat(SKILL_CONTENT_MAX + 1);
      await expect(
        skillsSaveOperation.execute(
          snap,
          {
            name: 'over-boundary',
            description: 'Boundary test at 8001 chars',
            content: overContent,
          },
          context,
        ),
      ).rejects.toThrow();

      // Empty content: rejected
      await expect(
        skillsSaveOperation.execute(
          snap,
          {
            name: 'empty-content',
            description: 'Empty body test',
            content: '',
          },
          context,
        ),
      ).rejects.toThrow();

      // Single character content: accepted
      const singleRes = await skillsSaveOperation.execute(
        snap,
        {
          name: 'single-char',
          description: 'Single character content',
          content: 'A',
        },
        context,
      );
      expect(singleRes.name).toBe('single-char');
    });

    it('boundary test: rejects 41st skill when 40-skill ceiling is reached, but permits updates and renames', async () => {
      const initialSkills = Array.from({ length: MAX_SKILLS }, (_, i) => ({
        name: `skill-slot-${String(i + 1).padStart(2, '0')}`,
        description: `Description for skill ${i + 1}`,
        content: `Instructions for skill ${i + 1}`,
        alwaysApply: false,
        createdAt: 1000 + i,
        updatedAt: 1000 + i,
      }));

      const snap = createMockSnapshot({
        [SKILLS_FILE_PATH]: JSON.stringify({ version: 1, skills: initialSkills }),
      });

      // 1. Attempting to add a 41st new skill must be rejected
      await expect(
        skillsSaveOperation.execute(
          snap,
          {
            name: 'skill-slot-41',
            description: 'The 41st skill',
            content: 'Should be rejected due to MAX_SKILLS',
          },
          context,
        ),
      ).rejects.toThrow(/MAX_SKILLS_EXCEEDED: Project skills limit of 40 reached/i);

      // 2. Updating an existing skill among the 40 MUST SUCCEED
      const updateRes = await skillsSaveOperation.execute(
        snap,
        {
          name: 'skill-slot-01',
          description: 'Updated description for slot 1',
          content: 'Updated content for slot 1',
          alwaysApply: true,
        },
        context,
      );
      expect(updateRes.name).toBe('skill-slot-01');
      expect(updateRes.alwaysApply).toBe(true);

      const parsedFile = JSON.parse(updateRes.changes[0].content!);
      expect(parsedFile.skills).toHaveLength(MAX_SKILLS);
      expect(parsedFile.skills.find((s: any) => s.name === 'skill-slot-01').alwaysApply).toBe(true);

      // 3. Renaming an existing skill among the 40 MUST SUCCEED (replaces in place, count stays 40)
      const renameRes = await skillsSaveOperation.execute(
        snap,
        {
          name: 'renamed-slot-01',
          previousName: 'skill-slot-01',
          description: 'Renamed description',
          content: 'Renamed content',
        },
        context,
      );
      expect(renameRes.name).toBe('renamed-slot-01');
      const renamedParsed = JSON.parse(renameRes.changes[0].content!);
      expect(renamedParsed.skills).toHaveLength(MAX_SKILLS);
      expect(renamedParsed.skills.some((s: any) => s.name === 'renamed-slot-01')).toBe(true);
      expect(renamedParsed.skills.some((s: any) => s.name === 'skill-slot-01')).toBe(false);
    });

    it('enforces renaming collisions and nonexistent skills error paths', async () => {
      const snap = createMockSnapshot({
        [SKILLS_FILE_PATH]: JSON.stringify({
          version: 1,
          skills: [
            {
              name: 'alpha-skill',
              description: 'Alpha',
              content: 'Instructions A',
              alwaysApply: false,
              createdAt: 100,
              updatedAt: 100,
            },
            {
              name: 'beta-skill',
              description: 'Beta',
              content: 'Instructions B',
              alwaysApply: false,
              createdAt: 200,
              updatedAt: 200,
            },
          ],
        }),
      });

      // 1. Rename nonexistent skill
      await expect(
        skillsSaveOperation.execute(
          snap,
          {
            name: 'gamma-skill',
            previousName: 'ghost-skill',
            description: 'Desc',
            content: 'Content',
          },
          context,
        ),
      ).rejects.toThrow(/SKILL_NOT_FOUND: Skill "ghost-skill" does not exist to rename/i);

      // 2. Rename collision: alpha-skill renamed to beta-skill (which already exists)
      await expect(
        skillsSaveOperation.execute(
          snap,
          {
            name: 'beta-skill',
            previousName: 'alpha-skill',
            description: 'Desc',
            content: 'Content',
          },
          context,
        ),
      ).rejects.toThrow(/SKILL_EXISTS: Skill "beta-skill" already exists/i);

      // 3. Self-rename (previousName === name) should succeed without collision error
      const selfRes = await skillsSaveOperation.execute(
        snap,
        {
          name: 'alpha-skill',
          previousName: 'alpha-skill',
          description: 'Self-renamed Alpha',
          content: 'Updated content',
        },
        context,
      );
      expect(selfRes.name).toBe('alpha-skill');
      const parsed = JSON.parse(selfRes.changes[0].content!);
      expect(parsed.skills).toHaveLength(2);
      expect(parsed.skills.find((s: any) => s.name === 'alpha-skill').description).toBe('Self-renamed Alpha');
    });

    it('strictly validates skill name regex (/^[a-z0-9-]+$/)', async () => {
      const snap = createMockSnapshot({});
      const badNames = [
        'UpperCase',
        'CamelCase',
        'snake_case',
        'dot.separated',
        'space separated',
        'special!',
        'slash/name',
        '@symbol',
      ];

      for (const name of badNames) {
        expect(SKILL_NAME_REGEX.test(name), `Regex should reject name: ${name}`).toBe(false);
        await expect(
          skillsSaveOperation.execute(
            snap,
            { name, description: 'Test', content: 'Rules' },
            context,
          ),
          `skills.save should reject invalid name: ${name}`,
        ).rejects.toThrow();
      }

      const goodNames = ['valid-name', 'skill123', 'a-b-c-456'];
      for (const name of goodNames) {
        expect(SKILL_NAME_REGEX.test(name), `Regex should accept name: ${name}`).toBe(true);
      }
    });
  });
});
