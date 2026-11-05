import type { NativeTransfer, TransferDiagnostic } from '../../../shared/framer-transfer-envelope.mjs';

export type { NativeTransfer, TransferDiagnostic };
export type SourceProperties = Record<string, unknown>;
export interface SourceNode {
  id: string;
  kind: string;
  raw: SourceProperties;
  children: string[];
}
export interface SourceReference {
  targetId: string;
  property: string;
  optional?: boolean;
}
export interface SourceGraph {
  transfer: NativeTransfer;
  nodes: Map<string, SourceNode>;
  byKind: Map<string, string[]>;
  references: Map<string, SourceReference[]>;
  renderRootIds: string[];
  reachable: Set<string>;
  diagnostics: TransferDiagnostic[];
}
export interface ResolvedSourceNode {
  id: string;
  sourceId: string;
  kind: string;
  properties: SourceProperties;
  children: string[];
  provenance: string[];
}
export interface NativeFile { path: string; code: string; baseCode?: string; baseHash?: string; cursorPortal?: true; favicon?: string; faviconDark?: string; colorTokens?: import('../../generation/framer-token-gen').FramerColorToken[]; typographyTokens?: import('../../generation/framer-typography-gen').FramerTypographyToken[]; fontFaces?: import('../../project/preset-ops').WorkspaceFontFaceSpec[]; googleFonts?: import('../../../shared/google-font-import').GoogleFontRequest[] }
export interface NativeCompileResult {
  files: NativeFile[];
  createdIds: string[];
  identity: Record<string, string>;
  diagnostics: TransferDiagnostic[];
  omissions?: TransferDiagnostic[];
}
