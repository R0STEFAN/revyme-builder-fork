import { describe, it, expect } from 'vitest';
import {
  matchesBreadcrumbSearch,
  filterBreadcrumbItems,
} from '../SlugPageBreadcrumb';
import { getItemSlug, getItemDisplayLabel, getItemRecordId } from '@/shared/cms-accessor';

describe('SlugPageBreadcrumb search & item matching', () => {
  const sampleItems = [
    {
      id: 101,
      title: 'Дракон',
      slug: 'dragon-tattoo',
      category: 'mythology',
    },
    {
      id: 102,
      name: 'Blackwork Snake',
      slug: 'blackwork-snake',
      alt_text: 'Snake on forearm',
    },
    {
      _id: 'rec_abc',
      _slug: 'cherry-blossom',
      title: 'Сакура',
    },
    {
      id: 104,
      slug: 'minimal-geometry',
      // No explicit title/name, displays slug
    },
  ];

  describe('matchesBreadcrumbSearch', () => {
    it('returns true for empty or whitespace-only queries', () => {
      expect(matchesBreadcrumbSearch(sampleItems[0], '')).toBe(true);
      expect(matchesBreadcrumbSearch(sampleItems[0], '   ')).toBe(true);
    });

    it('returns false for null or non-object item', () => {
      expect(matchesBreadcrumbSearch(null, 'dragon')).toBe(false);
      expect(matchesBreadcrumbSearch(undefined, 'dragon')).toBe(false);
      expect(matchesBreadcrumbSearch('invalid' as any, 'dragon')).toBe(false);
    });

    it('matches by display title in Ukrainian / non-latin characters case-insensitively', () => {
      expect(matchesBreadcrumbSearch(sampleItems[0], 'Дракон')).toBe(true);
      expect(matchesBreadcrumbSearch(sampleItems[0], 'дракон')).toBe(true);
      expect(matchesBreadcrumbSearch(sampleItems[0], 'ДРАК')).toBe(true);
      expect(matchesBreadcrumbSearch(sampleItems[2], 'сакура')).toBe(true);
    });

    it('matches by latin route slug even when human title is non-latin', () => {
      // Ukrainian title "Дракон", but slug is "dragon-tattoo"
      expect(matchesBreadcrumbSearch(sampleItems[0], 'dragon')).toBe(true);
      expect(matchesBreadcrumbSearch(sampleItems[0], 'DRAGON')).toBe(true);
      expect(matchesBreadcrumbSearch(sampleItems[0], 'tattoo')).toBe(true);
      expect(matchesBreadcrumbSearch(sampleItems[2], 'cherry')).toBe(true);
    });

    it('matches by record identifier (id or _id)', () => {
      expect(matchesBreadcrumbSearch(sampleItems[0], '101')).toBe(true);
      expect(matchesBreadcrumbSearch(sampleItems[1], '102')).toBe(true);
      expect(matchesBreadcrumbSearch(sampleItems[2], 'rec_abc')).toBe(true);
      expect(matchesBreadcrumbSearch(sampleItems[2], 'REC_ABC')).toBe(true);
    });

    it('matches across alternative title/name fields (name vs title)', () => {
      expect(matchesBreadcrumbSearch(sampleItems[1], 'Snake')).toBe(true);
      expect(matchesBreadcrumbSearch(sampleItems[1], 'blackwork')).toBe(true);
    });

    it('matches items that rely on slug as their display label', () => {
      expect(matchesBreadcrumbSearch(sampleItems[3], 'geometry')).toBe(true);
      expect(matchesBreadcrumbSearch(sampleItems[3], 'minimal')).toBe(true);
    });

    it('does not match unrelated queries', () => {
      expect(matchesBreadcrumbSearch(sampleItems[0], 'phoenix')).toBe(false);
      expect(matchesBreadcrumbSearch(sampleItems[1], '999')).toBe(false);
    });
  });

  describe('filterBreadcrumbItems', () => {
    it('returns all items when query is empty, preserving full collection preview access', () => {
      const result = filterBreadcrumbItems(sampleItems, '');
      expect(result).toHaveLength(4);
      expect(result).toEqual(sampleItems);
    });

    it('returns all items when query contains only spaces', () => {
      const result = filterBreadcrumbItems(sampleItems, '   ');
      expect(result).toHaveLength(4);
    });

    it('filters items correctly by search query across multiple fields', () => {
      const dragonResult = filterBreadcrumbItems(sampleItems, 'dragon');
      expect(dragonResult).toHaveLength(1);
      expect(dragonResult[0].id).toBe(101);

      const cyrillicResult = filterBreadcrumbItems(sampleItems, 'сакура');
      expect(cyrillicResult).toHaveLength(1);
      expect(cyrillicResult[0]._id).toBe('rec_abc');
    });

    it('returns empty array when nothing matches', () => {
      const result = filterBreadcrumbItems(sampleItems, 'non-existent-search-term');
      expect(result).toHaveLength(0);
    });
  });

  describe('canonical slug selection and title separation', () => {
    it('getItemSlug always returns canonical route slug, never the human title', () => {
      // Ukrainian title "Дракон" -> canonical slug "dragon-tattoo"
      expect(getItemSlug(sampleItems[0])).toBe('dragon-tattoo');
      expect(getItemDisplayLabel(sampleItems[0])).toBe('Дракон');

      // _slug priority on local items
      expect(getItemSlug(sampleItems[2])).toBe('cherry-blossom');
      expect(getItemDisplayLabel(sampleItems[2])).toBe('Сакура');

      // Record ID fallback when no slug exists
      const itemWithOnlyId = { id: 777 };
      expect(getItemSlug(itemWithOnlyId)).toBe('777');
      expect(getItemRecordId(itemWithOnlyId)).toBe(777);
    });

    it('distinguishes human label from route slug for breadcrumb display', () => {
      const it = sampleItems[0];
      const label = getItemDisplayLabel(it);
      const slug = getItemSlug(it);

      expect(label).toBe('Дракон');
      expect(slug).toBe('dragon-tattoo');
      expect(label !== slug).toBe(true);
    });
  });
});
