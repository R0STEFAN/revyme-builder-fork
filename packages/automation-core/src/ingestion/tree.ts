// packages/automation-core/src/ingestion/tree.ts
import type { IngestionReporter } from './report';
import { IdManager } from './ids';
import { normalizeStyles } from './styles';
import type { UnitContext } from './units';

export interface IngestedNode {
  id: string;
  tag: string;
  name?: string;
  styles?: Record<string, string | number>;
  props?: Record<string, unknown>;
  text?: string;
  children?: IngestedNode[];
  isTransparent?: boolean;
}

const INLINE_FORMATTING_TAGS = new Set([
  'span',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'code',
  'small',
  'sub',
  'sup',
]);

export function ingestTreeNode(
  rawNode: {
    tag?: string;
    id?: string;
    name?: string;
    styles?: Record<string, string | number>;
    props?: Record<string, unknown>;
    text?: string;
    children?: any[];
  },
  idManager: IdManager,
  unitContext: UnitContext = {},
  reporter?: IngestionReporter,
  parentIsText = false
): IngestedNode {
  const tag = (rawNode.tag || 'div').toLowerCase();
  const isInline = INLINE_FORMATTING_TAGS.has(tag) && parentIsText;

  const { id } = idManager.ensureNodeId(rawNode.id, tag, reporter);

  const styles = rawNode.styles
    ? normalizeStyles(rawNode.styles, unitContext, reporter, id)
    : undefined;

  const node: IngestedNode = {
    id,
    tag,
    name: rawNode.name || tag,
    styles,
    props: rawNode.props ? { ...rawNode.props } : undefined,
    text: rawNode.text,
    isTransparent: isInline,
  };

  if (Array.isArray(rawNode.children) && rawNode.children.length > 0) {
    node.children = rawNode.children.map((child) =>
      ingestTreeNode(child, idManager, unitContext, reporter, tag === 'p' || isInline)
    );
  }

  return node;
}
