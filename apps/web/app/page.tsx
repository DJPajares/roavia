import { Button, ExperienceState, TrustNotice } from "@roavia/ui";
import Link from "next/link";

export default function HomePage() {
  return (
    <>
      <section className="welcome-grid">
        <div className="welcome-copy">
          <p className="eyebrow">A quieter way to go farther</p>
          <h1>Travel planning that keeps the signal, loses the noise.</h1>
          <p className="welcome-copy__lede">
            Roavia brings the context around a trip into one dependable workspace—so each next
            choice feels considered, not crowded.
          </p>
          <div className="welcome-copy__actions">
            <Link className="roavia-button roavia-button--accent" href="/auth/sign-up?next=%2Fplan">
              Start with an intention
            </Link>
            <Button tone="quiet">See how Roavia works</Button>
          </div>
        </div>
        <aside aria-label="Roavia planning principles" className="compass-panel">
          <p className="compass-panel__kicker">The Roavia compass</p>
          <ol>
            <li>
              <span>01</span>
              <strong>Begin with why</strong>
              <p>Plans stay anchored to the traveler’s real intention.</p>
            </li>
            <li>
              <span>02</span>
              <strong>Show the evidence</strong>
              <p>Freshness, uncertainty, and sources remain visible.</p>
            </li>
            <li>
              <span>03</span>
              <strong>Keep the next move clear</strong>
              <p>Useful decisions are never hidden behind a busy surface.</p>
            </li>
          </ol>
        </aside>
      </section>
      <section aria-labelledby="foundation-heading" className="foundation-section">
        <div className="section-heading">
          <p className="eyebrow">Foundation check</p>
          <h2 id="foundation-heading">A shared language for every journey.</h2>
        </div>
        <div className="state-grid">
          <ExperienceState
            detail="A single status pattern keeps uncertain moments calm and actionable."
            state="loading"
            title="Preparing your workspace"
          />
          <ExperienceState
            detail="No saved plans yet—start from an intention when you are ready."
            state="empty"
            title="Your trips will appear here"
          />
          <ExperienceState
            detail="Continue browsing your essentials even when the connection is away."
            state="offline"
            title="Built for the gaps between signals"
          />
        </div>
      </section>
      <TrustNotice label="Designed for trust">
        Roavia makes a distinction between live information, interpreted guidance, and your own
        decisions—before any planning feature is added.
      </TrustNotice>
    </>
  );
}
