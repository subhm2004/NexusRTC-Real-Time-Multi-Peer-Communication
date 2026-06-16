export function LoadingSpinner({ label }: { label?: string }) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <div className="spinner" aria-hidden />
      {label && <p className="loading-state-label">{label}</p>}
    </div>
  );
}
