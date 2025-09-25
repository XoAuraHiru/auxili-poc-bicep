import "./LoadingOverlay.css";

function LoadingOverlay({ message = "Working..." }) {
  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <div className="loading-spinner" />
      <p>{message}</p>
    </div>
  );
}

export default LoadingOverlay;
