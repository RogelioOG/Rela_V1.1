/**
 * Devuelve el sub-concepto de intereses de mora parametrizado.
 * Prioriza el hijo de un concepto que causa intereses (y es el predeterminado).
 */
export function resolveInterestConcept(concepts: any[]): any | null {
  const late = concepts.filter(c => c.is_late_interest === true && c.is_active !== false);
  if (late.length === 0) return null;

  const byId = new Map(concepts.map(c => [c.id, c]));
  const parentOf = (c: any) => (c.parent_concept_id ? byId.get(c.parent_concept_id) : null);

  return (
    late.find(c => parentOf(c)?.causa_intereses && parentOf(c)?.is_default) ||
    late.find(c => parentOf(c)?.causa_intereses) ||
    late[0]
  );
}

/** Lanza error si hay intereses por contabilizar y faltan las cuentas parametrizadas. */
export function assertInterestAccounts(concept: any | null, hasInterest: boolean) {
  if (!hasInterest) return;
  if (!concept || !concept.counterpart_account_id || !concept.income_account_id) {
    throw new Error(
      'CONFIG: El sub-concepto de intereses de mora no tiene cuentas parametrizadas en Conceptos de Cobro. No se guardó ningún asiento.'
    );
  }
}