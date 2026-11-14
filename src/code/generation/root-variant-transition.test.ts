import { describe, expect, test } from 'vitest';
import { readTransitionVarRef, setMotionConfigBaseVar, syncRootVariantTransition, updateMotionConfigTransition } from './generator-motion';

const component = `import { motion, MotionConfig } from 'framer-motion';
const rootVariants = {
  default: {},
  'variant-1': { transition: { duration: 0 } },
};
function Dot() {
  const [variant, setVariant] = useState('default');
  return <MotionConfig transition={{ duration: 0.9 }}>
    <motion.div data-id="root" variants={rootVariants} animate={['default', variant]}>
      <motion.svg data-id="dot" animate={['default', variant]} />
    </motion.div>
  </MotionConfig>;
}`;

describe('root variant transition', () => {
  test('the root variant transition reaches animated descendants', () => {
    const result = syncRootVariantTransition(component, 'root');
    expect(result).toContain("(rootVariants as Record<string, any>)[variant]?.transition ?? { duration: 0.9 }");
    expect(syncRootVariantTransition(result, 'root')).toBe(result);
  });

  test('editing the default transition preserves the variant override', () => {
    const result = updateMotionConfigTransition(syncRootVariantTransition(component, 'root'), { duration: '0' });
    expect(result).toContain("(rootVariants as Record<string, any>)[variant]?.transition ?? { duration: 0 }");
  });

  test('binding a variable to the default transition preserves the variant override', () => {
    const cascaded = syncRootVariantTransition(component, 'root');
    const result = setMotionConfigBaseVar(cascaded, 'baseTransition');
    expect(result).toContain("(rootVariants as Record<string, any>)[variant]?.transition ?? baseTransition");
    expect(readTransitionVarRef(result, 'root', 'motionConfig')).toBe('baseTransition');
    const rebound = setMotionConfigBaseVar(result, 'otherTransition');
    expect(readTransitionVarRef(rebound, 'root', 'motionConfig')).toBe('otherTransition');
  });

  test('preserves an existing per-variant transition variable chain as the fallback', () => {
    const chained = component.replace('transition={{ duration: 0.9 }}', "transition={variant === 'variant-1' ? customTransition : baseTransition}");
    const result = syncRootVariantTransition(chained, 'root');
    expect(result).toContain("[variant]?.transition ?? (variant === 'variant-1' ? customTransition : baseTransition)");
    expect(updateMotionConfigTransition(result, { duration: '0' })).toContain('[variant]?.transition ?? { duration: 0 }');
  });

  test('supports variants wrapped for instance size overrides', () => {
    const wrapped = component.replace('variants={rootVariants}', 'variants={__applyInstanceSize(rootVariants, size)}');
    expect(syncRootVariantTransition(wrapped, 'root')).toContain('[variant]?.transition ?? { duration: 0.9 }');
  });

  test('wraps the root instead of rewriting a child instance MotionConfig', () => {
    const nested = component.replace('<MotionConfig transition={{ duration: 0.9 }}>\n    <motion.div', '<motion.div')
      .replace('</motion.div>\n  </MotionConfig>', '</motion.div>')
      .replace('<motion.svg data-id="dot" animate={[\'default\', variant]} />', '<MotionConfig transition={{ duration: 0.2 }}><motion.svg data-id="dot" animate={[\'default\', variant]} /></MotionConfig>');
    const result = syncRootVariantTransition(nested, 'root');
    expect(result).toContain('<MotionConfig transition={{ duration: 0.2 }}><motion.svg');
    expect(result).toContain('<MotionConfig transition={(rootVariants as Record<string, any>)[variant]?.transition ?? {}}><motion.div data-id="root"');
  });
});
