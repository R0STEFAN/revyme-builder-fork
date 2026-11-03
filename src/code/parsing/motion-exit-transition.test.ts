import { expect, it } from 'vitest';
import { parseJSXToNodes } from './parser';
import { updateMotionPropInCode } from '../generation/generator-motion-props';

it('keeps an independent exit transition and its easing through a motion-property edit', () => {
  const code = `import { motion } from 'framer-motion'; export default function Page(){return <motion.div data-id="box" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0, transition:{ type:'tween', duration:0.8, delay:0.3, ease:[0.6,0.2,0,1] }}} transition={{duration:0.4,ease:[0.44,0,0.56,1]}} />;}`;
  const props = parseJSXToNodes(code).get('box')!.motionProps!;
  expect(props.exit?.transition).toContain('delay:0.3');
  expect(props.transition?.ease).toBe('[0.44,0,0.56,1]');
  const updated = updateMotionPropInCode(code, 'box', 'exit', { ...props.exit!, opacity: '0.2' });
  expect(parseJSXToNodes(updated).get('box')?.motionProps?.exit).toMatchObject({ opacity: '0.2', transition: props.exit!.transition });
});
