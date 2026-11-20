/** Show plain Content as a valid string literal when opening the FX editor. */
export function toTextExpressionLiteral(content: string): string {
  return content ? JSON.stringify(content) : '';
}
