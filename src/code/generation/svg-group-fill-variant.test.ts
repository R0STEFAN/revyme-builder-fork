import { describe, expect, it } from 'vitest';
import { updateVariantStyleInCode } from './generator-styles';
import { checkFile } from '@/code/oracle/check-file';

describe('SVG group path fill variant', () => {
  it('keeps the default path fill and animates the hover fill in generated JSX', () => {
    const source = `import { motion } from 'framer-motion';
const variantConfig = [{ name: 'default' }, { name: 'default-hover' }];
function Icon({ initialVariant = 'default' }) {
  const variant = initialVariant;
  return <motion.svg data-id="group" animate={['default', variant]}>
    <svg data-id="leaf"><path data-id="shape" fill="var(--color-foreground-light)" d="M0 0 L10 10" /></svg>
  </motion.svg>;
}
export default Icon;`;

    const result = updateVariantStyleInCode(source, 'shape', 'default-hover', { fill: '#000000' });
    expect(result).toContain("fill: 'var(--color-foreground-light)'");
    expect(result).toContain("'default-hover': { fill: '#000000' }");
    expect(result).toContain('<motion.path data-id="shape"');
    expect(result).toContain("animate={['default', variant]}");
    expect(result).toContain('fill="var(--color-foreground-light)"');
    expect(checkFile(result, { kind: 'component' }).filter((issue) => issue.code === 'DEFAULT_VALUE_NOT_IN_BASE')).toEqual([]);
  });
});
