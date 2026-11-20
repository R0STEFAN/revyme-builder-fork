import type { IngestedNode } from './tree';
import type { IdManager } from './ids';
import type { IngestionReporter } from './report';

const WRAPPER_PAINT_ATTRS = new Set([
  'fill',
  'stroke',
  'stroke-width',
  'strokeWidth',
  'stroke-dasharray',
  'strokeDasharray',
  'stroke-linecap',
  'strokeLinecap',
  'stroke-linejoin',
  'strokeLinejoin',
]);

const GEOMETRY_PRIMITIVE_TAGS = new Set([
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polygon',
  'polyline',
]);

const PRIMITIVE_GEOM_ATTRS = new Set([
  'x', 'y', 'width', 'height', 'rx', 'ry',
  'cx', 'cy', 'r',
  'x1', 'y1', 'x2', 'y2',
  'points',
]);

function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function fmt(n: number): string {
  const rounded = Math.round(n * 1000) / 1000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function parseViewBox(props?: Record<string, unknown>): {
  minX: number;
  minY: number;
  width: number;
  height: number;
  str: string;
} {
  const raw = typeof props?.viewBox === 'string' ? props.viewBox.trim() : '';
  if (raw) {
    const parts = raw.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
      return { minX: parts[0], minY: parts[1], width: parts[2], height: parts[3], str: raw };
    }
  }
  const w = num(props?.width, 24) || 24;
  const h = num(props?.height, 24) || 24;
  return { minX: 0, minY: 0, width: w, height: h, str: `0 0 ${fmt(w)} ${fmt(h)}` };
}

function primitiveToPathD(tag: string, props: Record<string, unknown> = {}): string {
  switch (tag) {
    case 'rect': {
      const x = num(props.x, 0);
      const y = num(props.y, 0);
      const w = Math.max(0, num(props.width, 0));
      const h = Math.max(0, num(props.height, 0));
      const rawRx = props.rx !== undefined ? num(props.rx, 0) : num(props.ry, 0);
      const rawRy = props.ry !== undefined ? num(props.ry, 0) : rawRx;
      const rx = Math.min(Math.max(0, rawRx), w / 2);
      const ry = Math.min(Math.max(0, rawRy), h / 2);
      if (rx > 0 || ry > 0) {
        return `M${fmt(x + rx)} ${fmt(y)}H${fmt(x + w - rx)}A${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x + w)} ${fmt(y + ry)}V${fmt(y + h - ry)}A${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x + w - rx)} ${fmt(y + h)}H${fmt(x + rx)}A${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x)} ${fmt(y + h - ry)}V${fmt(y + ry)}A${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x + rx)} ${fmt(y)}Z`;
      }
      return `M${fmt(x)} ${fmt(y)}H${fmt(x + w)}V${fmt(y + h)}H${fmt(x)}Z`;
    }
    case 'circle': {
      const cx = num(props.cx, 0);
      const cy = num(props.cy, 0);
      const r = Math.max(0, num(props.r, 0));
      return `M${fmt(cx - r)} ${fmt(cy)}A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx + r)} ${fmt(cy)}A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx - r)} ${fmt(cy)}Z`;
    }
    case 'ellipse': {
      const cx = num(props.cx, 0);
      const cy = num(props.cy, 0);
      const rx = Math.max(0, num(props.rx, 0));
      const ry = Math.max(0, num(props.ry, 0));
      return `M${fmt(cx - rx)} ${fmt(cy)}A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx + rx)} ${fmt(cy)}A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx - rx)} ${fmt(cy)}Z`;
    }
    case 'line': {
      const x1 = num(props.x1, 0);
      const y1 = num(props.y1, 0);
      const x2 = num(props.x2, 0);
      const y2 = num(props.y2, 0);
      return `M${fmt(x1)} ${fmt(y1)}L${fmt(x2)} ${fmt(y2)}`;
    }
    case 'polygon':
    case 'polyline': {
      const raw = String(props.points ?? '').trim();
      const nums = raw ? raw.split(/[\s,]+/).map(Number).filter(Number.isFinite) : [];
      const pairs: string[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) {
        pairs.push(`${fmt(nums[i])},${fmt(nums[i + 1])}`);
      }
      if (pairs.length === 0) return 'M0 0';
      return `M${pairs[0]} ${pairs.slice(1).map((p) => `L${p}`).join(' ')}${tag === 'polygon' ? 'Z' : ''}`;
    }
    default:
      return String(props.d ?? 'M0 0');
  }
}

export function splitSvgPathSubpaths(d: string): string[] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g);
  if (!tokens || tokens.length === 0) return d.trim() ? [d.trim()] : [];

  const subpaths: string[] = [];
  let parts: string[] = [];
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;
  let idx = 0;

  const nextNum = (): number => {
    const val = Number(tokens[idx++]);
    return Number.isFinite(val) ? val : 0;
  };
  const hasMoreNums = (): boolean => idx < tokens.length && !/^[a-zA-Z]$/.test(tokens[idx]);

  while (idx < tokens.length) {
    const cmd = tokens[idx];
    if (!/^[a-zA-Z]$/.test(cmd)) {
      idx++;
      continue;
    }
    idx++;

    switch (cmd) {
      case 'M':
      case 'm': {
        const isRel = cmd === 'm';
        let firstPair = true;
        while (hasMoreNums()) {
          const x = nextNum();
          const y = hasMoreNums() ? nextNum() : 0;
          const absX = isRel ? curX + x : x;
          const absY = isRel ? curY + y : y;
          if (firstPair) {
            if (parts.length > 0) {
              subpaths.push(parts.join(' ').trim());
              parts = [];
            }
            curX = absX;
            curY = absY;
            startX = absX;
            startY = absY;
            parts.push(`M${fmt(absX)} ${fmt(absY)}`);
            firstPair = false;
          } else {
            curX = absX;
            curY = absY;
            parts.push(`L${fmt(absX)} ${fmt(absY)}`);
          }
        }
        break;
      }
      case 'L':
      case 'l':
      case 'T':
      case 't': {
        const isRel = cmd === cmd.toLowerCase();
        const segArgs: string[] = [];
        while (hasMoreNums()) {
          const x = nextNum();
          const y = hasMoreNums() ? nextNum() : 0;
          curX = isRel ? curX + x : x;
          curY = isRel ? curY + y : y;
          segArgs.push(`${fmt(x)} ${fmt(y)}`);
        }
        if (segArgs.length) parts.push(`${cmd}${segArgs.join(' ')}`);
        break;
      }
      case 'H':
      case 'h': {
        const isRel = cmd === 'h';
        const segArgs: string[] = [];
        while (hasMoreNums()) {
          const x = nextNum();
          curX = isRel ? curX + x : x;
          segArgs.push(fmt(x));
        }
        if (segArgs.length) parts.push(`${cmd}${segArgs.join(' ')}`);
        break;
      }
      case 'V':
      case 'v': {
        const isRel = cmd === 'v';
        const segArgs: string[] = [];
        while (hasMoreNums()) {
          const y = nextNum();
          curY = isRel ? curY + y : y;
          segArgs.push(fmt(y));
        }
        if (segArgs.length) parts.push(`${cmd}${segArgs.join(' ')}`);
        break;
      }
      case 'C':
      case 'c': {
        const isRel = cmd === 'c';
        const segArgs: string[] = [];
        while (hasMoreNums()) {
          const vals = [0, 1, 2, 3, 4, 5].map(() => (hasMoreNums() ? nextNum() : 0));
          curX = isRel ? curX + vals[4] : vals[4];
          curY = isRel ? curY + vals[5] : vals[5];
          segArgs.push(vals.map(fmt).join(' '));
        }
        if (segArgs.length) parts.push(`${cmd}${segArgs.join(' ')}`);
        break;
      }
      case 'S':
      case 's':
      case 'Q':
      case 'q': {
        const isRel = cmd === cmd.toLowerCase();
        const segArgs: string[] = [];
        while (hasMoreNums()) {
          const vals = [0, 1, 2, 3].map(() => (hasMoreNums() ? nextNum() : 0));
          curX = isRel ? curX + vals[2] : vals[2];
          curY = isRel ? curY + vals[3] : vals[3];
          segArgs.push(vals.map(fmt).join(' '));
        }
        if (segArgs.length) parts.push(`${cmd}${segArgs.join(' ')}`);
        break;
      }
      case 'A':
      case 'a': {
        const isRel = cmd === 'a';
        const segArgs: string[] = [];
        while (hasMoreNums()) {
          const vals = [0, 1, 2, 3, 4, 5, 6].map(() => (hasMoreNums() ? nextNum() : 0));
          curX = isRel ? curX + vals[5] : vals[5];
          curY = isRel ? curY + vals[6] : vals[6];
          segArgs.push(vals.map(fmt).join(' '));
        }
        if (segArgs.length) parts.push(`${cmd}${segArgs.join(' ')}`);
        break;
      }
      case 'Z':
      case 'z': {
        curX = startX;
        curY = startY;
        parts.push(cmd);
        break;
      }
    }
  }

  if (parts.length > 0) {
    subpaths.push(parts.join(' ').trim());
  }
  return subpaths;
}

function clonePathWithD(
  base: IngestedNode,
  d: string,
  id: string,
  inheritedPaint: Record<string, unknown>,
): IngestedNode {
  const nextProps: Record<string, unknown> = {};
  if (base.props) {
    for (const [k, v] of Object.entries(base.props)) {
      if (PRIMITIVE_GEOM_ATTRS.has(k)) continue;
      nextProps[k] = v;
    }
  }
  for (const [pk, pv] of Object.entries(inheritedPaint)) {
    if (nextProps[pk] === undefined) {
      nextProps[pk] = pv;
    }
  }
  nextProps.d = d;
  return {
    id,
    tag: 'path',
    name: base.name,
    styles: base.styles ? { ...base.styles } : undefined,
    props: nextProps,
  };
}

export function healSvgSubtree(
  svgNode: IngestedNode,
  idManager: IdManager,
  reporter?: IngestionReporter,
): void {
  const vb = parseViewBox(svgNode.props);

  // Move any wrapper paint attrs onto child paths so Fill/Stroke controls resolve them.
  const inheritedPaint: Record<string, unknown> = {};
  if (svgNode.props) {
    for (const key of WRAPPER_PAINT_ATTRS) {
      if (svgNode.props[key] !== undefined) {
        inheritedPaint[key] = svgNode.props[key];
        delete svgNode.props[key];
      }
    }
  }

  if (!svgNode.children || svgNode.children.length === 0) return;

  const healedPaths: IngestedNode[] = [];
  const otherChildren: IngestedNode[] = [];

  const processChild = (child: IngestedNode, groupPaint: Record<string, unknown>) => {
    const tag = child.tag.replace(/^motion\./, '').toLowerCase();

    if (tag === 'g') {
      const mergedPaint = { ...groupPaint };
      if (child.props) {
        for (const key of WRAPPER_PAINT_ATTRS) {
          if (child.props[key] !== undefined) {
            mergedPaint[key] = child.props[key];
          }
        }
      }
      for (const grand of child.children ?? []) {
        processChild(grand, mergedPaint);
      }
      return;
    }

    if (tag === 'svg') {
      // Strip wrapper paint props off nested wrapper <svg> too
      if (child.props) {
        for (const key of WRAPPER_PAINT_ATTRS) {
          if (child.props[key] !== undefined) {
            delete child.props[key];
          }
        }
        if (child.children && child.children.length > 0 && child.props.overflow === undefined) {
          child.props.overflow = 'visible';
        }
      }
      otherChildren.push(child);
      return;
    }

    if (!GEOMETRY_PRIMITIVE_TAGS.has(tag)) {
      otherChildren.push(child);
      return;
    }

    const d = tag === 'path' ? String(child.props?.d ?? '') : primitiveToPathD(tag, child.props);
    if (tag !== 'path') {
      reporter?.recordNormalization('SVG_PRIMITIVE_TO_PATH', child.id, tag, 'path');
    }

    const childPaint = { ...groupPaint };
    const fillVal = child.props?.fill ?? childPaint.fill;
    const strokeOnly =
      fillVal === undefined || fillVal === null || fillVal === 'none' || fillVal === 'transparent';
    const subpathCount = (d.match(/[Mm]/g) ?? []).length;

    if (tag === 'path' && strokeOnly && subpathCount >= 2) {
      const subpaths = splitSvgPathSubpaths(d);
      if (subpaths.length >= 2) {
        reporter?.recordNormalization('SVG_SPLIT_MULTI_SUBPATH', child.id, String(subpaths.length), 'group');
        subpaths.forEach((subD, idx) => {
          const pathId = idx === 0 ? child.id : idManager.ensureNodeId(`${child.id}-${idx}`, 'path', reporter).id;
          healedPaths.push(clonePathWithD(child, subD, pathId, childPaint));
        });
        return;
      }
    }

    healedPaths.push(clonePathWithD(child, d, child.id, childPaint));
  };

  for (const child of svgNode.children) {
    processChild(child, inheritedPaint);
  }

  // If this svg ends up with a single geometry <path> and no nested <svg> wrappers,
  // keep it flat directly under the outer <svg>.
  if (otherChildren.length === 0 && healedPaths.length <= 1) {
    svgNode.children = healedPaths;
    return;
  }

  // Multiple geometry items -> group as nested <svg overflow="visible"> children so
  // each nested <svg> carries exactly one single-subpath <path>.
  const nestedWrappers: IngestedNode[] = healedPaths.map((pathNode, idx) => {
    const nestedId = idManager.ensureNodeId(`${svgNode.id}-s${idx}`, 'svg', reporter).id;
    return {
      id: nestedId,
      tag: 'svg',
      props: {
        x: String(vb.minX),
        y: String(vb.minY),
        width: String(vb.width),
        height: String(vb.height),
        viewBox: vb.str,
        overflow: 'visible',
      },
      children: [pathNode],
    };
  });

  if (!svgNode.props) svgNode.props = {};
  if (!svgNode.props.viewBox) svgNode.props.viewBox = vb.str;
  svgNode.children = [...otherChildren, ...nestedWrappers];
}
