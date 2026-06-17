export function GateStrip({
  approved, disclosed, isAiGenerated,
}: { approved: boolean; disclosed: boolean; isAiGenerated: boolean }) {
  const disclosureMet = disclosed || !isAiGenerated;
  const publishable = approved && disclosureMet;

  return (
    <div className="gate" role="group" aria-label="Publish gates">
      <div className={`cell ${approved ? 'pass' : 'fail'}`}>
        <span className="mark" aria-hidden>{approved ? '✓' : '–'}</span>
        <span className="lbl">Human approval</span>
      </div>

      <span className="connector" aria-hidden />

      <div className={`cell ${disclosureMet ? 'pass' : 'fail'}`}>
        <span className="mark" aria-hidden>{disclosureMet ? '✓' : '–'}</span>
        <span className="lbl">{isAiGenerated ? 'AI disclosure' : 'No disclosure needed'}</span>
      </div>

      <span className="connector" aria-hidden />

      <div className={`verdict ${publishable ? 'go' : 'hold'}`} aria-label="Publish status">
        {publishable ? (
          <>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M2 6.5L4.5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Cleared
          </>
        ) : (
          <>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
              <line x1="6" y1="3.5" x2="6" y2="6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="6" cy="8.2" r="0.7" fill="currentColor"/>
            </svg>
            Held
          </>
        )}
      </div>
    </div>
  );
}
