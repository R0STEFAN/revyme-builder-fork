export type TransferMode = 'selection' | 'component' | 'page' | 'project';
export interface SourceContext {
  projectId: string;
  branchId: string;
  revision: string;
  editorBuild: string;
  scopeId: string;
  mode: TransferMode;
}
export interface RawDefinition {
  id: string;
  kind: string;
  data: Record<string, unknown>;
}
export interface TransferDiagnostic {
  code: string;
  sourceId?: string;
  property?: string;
  message: string;
}
export interface NativeTransfer {
  format: 'revyme.framer.native';
  version: 1;
  context: SourceContext;
  rootIds: string[];
  definitions: RawDefinition[];
  assets: Record<string, unknown>[];
  codeFiles?: SourceCodeFile[];
  fonts?: SourceFontFile[];
  complete: boolean;
  diagnostics: TransferDiagnostic[];
}
export interface SourceFontFile {
  selector: string;
  family: string;
  url: string;
  weight: number;
  weightRange?: { min: number; max: number };
  style: 'normal' | 'italic';
  ext: 'woff2' | 'woff' | 'otf' | 'ttf';
}
export interface SourceCodeFile {
  sourceId: string;
  path: string;
  moduleId: string;
  saveId: string;
  code: string;
}
export function decodeNativeTransfer(value: unknown): NativeTransfer;
