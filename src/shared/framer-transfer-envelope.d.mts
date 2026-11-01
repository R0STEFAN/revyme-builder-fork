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
  complete: boolean;
  diagnostics: TransferDiagnostic[];
}
export function decodeNativeTransfer(value: unknown): NativeTransfer;
