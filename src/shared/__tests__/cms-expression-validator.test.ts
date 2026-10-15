import { describe, it, expect } from 'vitest';
import { validateCmsExpression } from '../cms-expression-validator';

describe('validateCmsExpression', () => {
  it('allows valid member access, string interpolation and expressions', () => {
    expect(validateCmsExpression('item.title').valid).toBe(true);
    expect(validateCmsExpression('`${item.title.toUpperCase()} | Store`').valid).toBe(true);
    expect(validateCmsExpression('item.price ? "$" + item.price : "Free"').valid).toBe(true);
  });

  it('rejects prototype pollution and sandbox escape attempts', () => {
    expect(validateCmsExpression("item.constructor.constructor('return 6 * 7')()").valid).toBe(false);
    expect(validateCmsExpression('item.__proto__.polluted = true').valid).toBe(false);
    expect(validateCmsExpression('Object.prototype.evil = true').valid).toBe(false);
  });

  it('rejects forbidden globals and assignments', () => {
    expect(validateCmsExpression('process.exit(1)').valid).toBe(false);
    expect(validateCmsExpression('require("fs")').valid).toBe(false);
    expect(validateCmsExpression('window.location = "http://evil.com"').valid).toBe(false);
    expect(validateCmsExpression('item.title = "hacked"').valid).toBe(false);
  });
});
