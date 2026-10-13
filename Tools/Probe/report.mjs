export function observedTechnicalIo(report) {
  if (report.status !== 'ready' || report.truncated || report.counts?.['lifecycle:vault-load-start'] !== 1 || report.counts?.['scanner:listAll'] !== 1 || report.counts?.['lifecycle:layout-ready'] !== 1) return null;
  return report.events.filter((event) => event.kind === 'io' && (event.path === 'Technical' || event.path?.startsWith('Technical/'))).length;
}
